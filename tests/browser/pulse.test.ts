// Node >= 22.18: node --test tests/browser/pulse.test.ts
// These are isolated browser integration tests, not live auth/API/DB or email E2E.
import assert from "node:assert/strict";
import { before, after, test as nodeTest, type TestContext } from "node:test";
import type { Page, Locator, Route } from "playwright-core";
import { startHarness } from "./harness.mjs";
import { ids, initialContent, longContent, microseconds, literalQuery, message } from "./seed.ts";
import { messageToolsCopy } from "../../components/chat/messageToolsCopy.ts";

type Labels = typeof messageToolsCopy.en;
const test = (name: string, run: (t: TestContext) => Promise<void>) => nodeTest(name, { timeout: 25000 }, run);
let harness: Awaited<ReturnType<typeof startHarness>>;
before(async () => { harness = await startHarness(); });
after(async () => { if (harness) await harness.close(); });
const en = messageToolsCopy.en;
const row = (page: Page, id = ids.outgoing) => page.locator(`#message-${id}`);
const button = (scope: Page | Locator, name: string) => scope.getByRole("button", { name, exact: true });
async function textVisible(scope: Page | Locator, text: string) { await scope.getByText(text, { exact: true }).waitFor({ state: "visible" }); }
async function openActions(page: Page, id = ids.outgoing, labels: Labels = en) {
    const target = row(page, id);
    const toggle = button(target, labels.actions);
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await target.getByRole("group", { name: labels.actions, exact: true }).waitFor();
    return target;
}
async function openTool(page: Page, mode: "edit" | "forward", labels: Labels = en) {
    await button(await openActions(page, ids.outgoing, labels), labels[mode]).click();
    const dialog = page.getByRole("dialog", { name: labels[mode], exact: true });
    await dialog.waitFor();
    return dialog;
}
async function openSearch(page: Page, labels: Labels = en) {
    await button(page, labels.search).click();
    const dialog = page.getByRole("dialog", { name: labels.search, exact: true });
    await dialog.waitFor();
    return dialog;
}
function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
async function json(route: Route, payload: unknown, status = 200) {
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}
async function bodyContains(locator: Locator, text: string) {
    await locator.filter({ hasText: text }).waitFor();
}

for (const width of [390, 1280]) for (const language of ["en", "fr"] as const) {
    test(`alignment and multiline wrapping at ${width}px, ${language}, ${language === "fr" ? "dark" : "light"}`, async t => {
        const theme = language === "fr" ? "dark" : "light";
        const page = await harness.open(t, { width, language, theme });
        const labels = messageToolsCopy[language];
        assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
        for (const [id, outgoing] of [[ids.incoming, false], [ids.outgoing, true]] as const) {
            const target = row(page, id);
            const bounds = await target.boundingBox();
            const bubble = await target.locator(".bubble").boundingBox();
            assert.ok(bounds && bubble);
            const nearEdge = outgoing ? bounds.x + bounds.width - bubble.x - bubble.width : bubble.x - bounds.x;
            assert.ok(nearEdge >= -1 && nearEdge <= 36, `bubble must align ${outgoing ? "right" : "left"}; edge gap ${nearEdge}`);
            const center = bubble.x + bubble.width / 2;
            assert.ok(outgoing ? center > bounds.x + bounds.width / 2 : center < bounds.x + bounds.width / 2);
        }
        const long = row(page, ids.long).locator(".bubble");
        assert.ok((await long.textContent())?.includes(longContent));
        assert.equal(await long.evaluate(element => getComputedStyle(element).whiteSpace), "pre-wrap");
        await openActions(page, ids.long, labels);
        const overflow = await page.locator("html, body, .chat-panel, .message-list, .message-row, .bubble, .bubble-actions:not([hidden])").evaluateAll(elements =>
            elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => `${element.tagName}.${element.className}: ${element.scrollWidth}>${element.clientWidth}`));
        assert.deepEqual(overflow, [], "Long unbroken/multiline content or actions overflow horizontally");
        if (theme === "dark") assert.equal(await long.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(0, 92, 75)");
    });
}

test("actions work with click and keyboard; incoming, deleted and audio capabilities", async t => {
    const page = await harness.open(t);
    const outgoing = row(page);
    await outgoing.locator(".bubble").click();
    assert.equal(await button(outgoing, en.actions).getAttribute("aria-expanded"), "true");
    await button(outgoing, en.actions).focus();
    await page.keyboard.press("Escape");
    assert.equal(await button(outgoing, en.actions).getAttribute("aria-expanded"), "false");
    await page.keyboard.press("Enter");
    await button(outgoing, en.edit).waitFor();
    const incoming = await openActions(page, ids.incoming);
    assert.equal(await button(incoming, en.edit).count(), 0);
    await button(incoming, en.copy).waitFor();
    await button(incoming, en.forward).waitFor();
    assert.equal(await row(page, ids.deleted).getByRole("button").count(), 0);
    const audio = await openActions(page, ids.audio);
    for (const name of [en.copy, en.edit, en.forward]) assert.equal(await button(audio, name).count(), 0);
});

for (const fail of [false, true]) test(`copy ${fail ? "failure is visible" : "success writes exact multiline text"}`, async t => {
    const page = await harness.open(t);
    await page.evaluate(fail => { (window as any).pulseFixture.clipboard.fail = fail; }, fail);
    await button(await openActions(page), en.copy).click();
    await textVisible(page, fail ? en.copyFailed : en.copied);
    assert.deepEqual(await page.evaluate(() => (window as any).pulseFixture.clipboard.writes), fail ? [] : [initialContent]);
    assert.equal(await button(row(page), en.actions).getAttribute("aria-expanded"), "false");
});

test("edit initializes content, enforces 4000/blank/unchanged, cancels without saving", async t => {
    const page = await harness.open(t);
    const requests: string[] = [];
    await page.route("**/api/messages**", async route => { requests.push(route.request().method()); await json(route, {}, 500); });
    const dialog = await openTool(page, "edit");
    const input = dialog.getByRole("textbox", { name: en.editLabel });
    assert.equal(await input.inputValue(), initialContent);
    assert.equal(await button(dialog, en.save).isDisabled(), true);
    assert.equal(await input.getAttribute("maxlength"), "4000");
    await input.fill("x".repeat(4001));
    assert.equal((await input.inputValue()).length, 4000);
    await input.fill(" \n  ");
    assert.equal(await button(dialog, en.save).isDisabled(), true);
    await input.press("Control+Enter");
    await button(dialog, en.cancel).click();
    await dialog.waitFor({ state: "hidden" });
    await bodyContains(row(page), initialContent);
    assert.deepEqual(requests, []);
});

for (const status of [400, 409]) test(`edit HTTP ${status} preserves draft and exposes correct error`, async t => {
    const page = await harness.open(t);
    const payloads: any[] = [];
    await page.route("**/api/messages", async route => {
        assert.equal(route.request().method(), "PATCH");
        payloads.push(route.request().postDataJSON());
        await json(route, { error: "Synthetic server failure" }, status);
    });
    const dialog = await openTool(page, "edit");
    const draft = `Edited draft ${status}\nPreserve me`;
    await dialog.getByRole("textbox").fill(draft);
    await button(dialog, en.save).click();
    await textVisible(dialog, status === 409 ? en.conflict : en.editFailed);
    assert.equal(await dialog.getByRole("alert").count(), 1);
    assert.equal(await dialog.getByRole("textbox").inputValue(), draft);
    assert.equal(await button(dialog, en.save).isEnabled(), true);
    assert.deepEqual(payloads, [{ conversationId: ids.conversation, messageId: ids.outgoing, content: draft, previousContent: initialContent }]);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    await bodyContains(row(page), initialContent);
});

test("edit saves trimmed text with original-content concurrency token and updates bubble", async t => {
    const page = await harness.open(t);
    const payloads: any[] = [];
    const gate = deferred();
    const requested = deferred();
    await page.route("**/api/messages", async route => {
        assert.equal(route.request().method(), "PATCH");
        const payload = route.request().postDataJSON();
        payloads.push(payload);
        requested.resolve();
        await gate.promise;
        await json(route, { message: message({ id: ids.outgoing, sender_id: ids.self, content: payload.content }) });
    });
    t.after(() => gate.resolve());
    const dialog = await openTool(page, "edit");
    await dialog.getByRole("textbox").fill("  Saved text\nSecond line  ");
    await button(dialog, en.save).click();
    await requested.promise;
    assert.equal(await button(dialog, en.saving).isDisabled(), true);
    assert.equal(await dialog.getByRole("textbox").isDisabled(), true);
    gate.resolve();
    await dialog.waitFor({ state: "hidden" });
    await bodyContains(row(page), "Saved text\nSecond line");
    assert.deepEqual(payloads, [{ conversationId: ids.conversation, messageId: ids.outgoing, content: "Saved text\nSecond line", previousContent: initialContent }]);
});

for (const change of ["edit", "delete"] as const) test(`late PATCH cannot overwrite a newer realtime ${change}`, async t => {
    const page = await harness.open(t);
    const gate = deferred();
    const requested = deferred();
    const payloads: any[] = [];
    await page.route("**/api/messages", async route => {
        assert.equal(route.request().method(), "PATCH");
        payloads.push(route.request().postDataJSON());
        requested.resolve();
        await gate.promise;
        await json(route, { message: message({ id: ids.outgoing, sender_id: ids.self, content: "Saved earlier", deleted_at: null }) });
    });
    t.after(() => gate.resolve());
    const dialog = await openTool(page, "edit");
    await dialog.getByRole("textbox").fill("Saved earlier");
    await button(dialog, en.save).click();
    await requested.promise;
    const update = change === "edit"
        ? { content: "Newer realtime edit" }
        : { content: "", deleted_at: "2026-01-02T03:04:06.000Z" };
    const delivered = await page.evaluate(({ id, update }) => (window as any).pulseFixture.emitMessageUpdate(id, update), { id: ids.outgoing, update });
    assert.equal(delivered, 1, "The realtime UPDATE must arrive while PATCH is still pending");
    if (change === "edit") await bodyContains(row(page), "Newer realtime edit");
    else {
        await button(row(page), en.actions).waitFor({ state: "hidden" });
        assert.equal((await row(page).locator(".bubble").innerText()).includes(initialContent), false);
        assert.equal(await row(page).getByRole("button").count(), 0);
    }
    const newerBubble = await row(page).locator(".bubble").innerText();
    const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/messages" && response.request().method() === "PATCH");
    gate.resolve();
    await (await response).finished();
    await dialog.waitFor({ state: "hidden" });
    // Let the completed response handler and React render run before checking absence.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await row(page).locator(".bubble").innerText(), newerBubble, "An older PATCH response must preserve the newer realtime state");
    assert.equal((await row(page).textContent())?.includes("Saved earlier"), false);
    if (change === "delete") assert.equal(await row(page).getByRole("button").count(), 0, "A late save must not resurrect deleted-message actions");
    assert.deepEqual(payloads, [{ conversationId: ids.conversation, messageId: ids.outgoing, content: "Saved earlier", previousContent: initialContent }]);
});

for (const close of ["cancel", "escape"]) test(`edit ${close} returns keyboard focus to a visible message action trigger`, async t => {
    const page = await harness.open(t);
    const dialog = await openTool(page, "edit");
    if (close === "cancel") await button(dialog, en.cancel).click();
    else await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    const focus = await button(row(page), en.actions).evaluate(element => ({
        restored: element === document.activeElement,
        actual: `${document.activeElement?.tagName}.${document.activeElement?.className}`
    }));
    assert.equal(focus.restored, true,
        `Closing dialog must restore focus to the visible message actions trigger; focused ${focus.actual}`);
});

test("forward requires target, sends source reference only, and reports success", async t => {
    const page = await harness.open(t, { width: 390, language: "fr", theme: "dark" });
    const labels = messageToolsCopy.fr;
    const payloads: any[] = [];
    await page.route("**/api/messages", async route => {
        assert.equal(route.request().method(), "POST");
        payloads.push(route.request().postDataJSON());
        await json(route, { message: message({ conversation_id: ids.destination }) });
    });
    const dialog = await openTool(page, "forward", labels);
    assert.equal(await button(dialog, labels.forward).isDisabled(), true);
    await textVisible(dialog, labels.forwardNote);
    assert.equal(await dialog.getByRole("combobox").locator("option").count(), 2);
    await dialog.getByRole("combobox").selectOption(ids.destination);
    await button(dialog, labels.forward).click();
    await dialog.waitFor({ state: "hidden" });
    await textVisible(page, labels.forwarded);
    assert.equal(payloads.length, 1);
    assert.match(payloads[0].messageId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(payloads[0], { conversationId: ids.destination, messageId: payloads[0].messageId, forwardMessageId: ids.outgoing });
});

test("forward error preserves destination and retries with the same idempotency key", async t => {
    const page = await harness.open(t);
    const payloads: any[] = [];
    await page.route("**/api/messages", async route => {
        payloads.push(route.request().postDataJSON());
        await json(route, payloads.length === 1 ? { error: "Synthetic failure" } : { message: message() }, payloads.length === 1 ? 403 : 200);
    });
    const dialog = await openTool(page, "forward");
    await dialog.getByRole("combobox").selectOption(ids.destination);
    await button(dialog, en.forward).click();
    await textVisible(dialog, en.forwardFailed);
    assert.equal(await dialog.getByRole("combobox").inputValue(), ids.destination);
    await button(dialog, en.forward).click();
    await dialog.waitFor({ state: "hidden" });
    await textVisible(page, en.forwarded);
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads[0], payloads[1]);
});

test("search debounces 300ms, shows loading and empty, and Escape closes", async t => {
    const page = await harness.open(t);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const queries: string[] = [];
    const requested = deferred();
    const gate = deferred();
    await page.route("**/api/messages?**", async route => {
        queries.push(new URL(route.request().url()).searchParams.get("q")!);
        requested.resolve();
        await gate.promise;
        await json(route, { messages: [], nextCursor: null });
    });
    t.after(() => gate.resolve());
    const dialog = await openSearch(page);
    const input = dialog.getByRole("searchbox");
    await input.fill("first");
    await page.clock.runFor(200);
    await input.fill("no match");
    await page.clock.runFor(299);
    assert.deepEqual(queries, [], "No search before debounce quiet period");
    await textVisible(dialog, en.loading);
    await page.clock.runFor(1);
    await requested.promise;
    assert.deepEqual(queries, ["no match"]);
    gate.resolve();
    await textVisible(dialog, en.searchEmpty);
    // Chromium consumes the first Escape inside a populated type=search input.
    // Move focus to the close control to exercise the dialog cancel event itself.
    await button(dialog, en.close).focus();
    await page.keyboard.press("Escape");
    await page.clock.runFor(1);
    await dialog.waitFor({ state: "hidden" });
});

test("search HTTP error is visible and a changed query recovers", async t => {
    const page = await harness.open(t, { language: "fr", theme: "dark" });
    const labels = messageToolsCopy.fr;
    await page.route("**/api/messages?**", async route => {
        const fail = new URL(route.request().url()).searchParams.get("q") === "failure";
        await json(route, fail ? { error: "Synthetic failure" } : { messages: [], nextCursor: null }, fail ? 500 : 200);
    });
    const dialog = await openSearch(page, labels);
    await dialog.getByRole("searchbox").fill("failure");
    await textVisible(dialog, labels.searchFailed);
    assert.equal(await dialog.getByRole("alert").count(), 1);
    await dialog.getByRole("searchbox").fill("recovered");
    await textVisible(dialog, labels.searchEmpty);
    assert.equal(await dialog.getByRole("alert").count(), 0);
});

test("search preserves literal special query and microsecond cursor; pages deduplicate and copy", async t => {
    const page = await harness.open(t);
    const urls: URL[] = [];
    const first = message({ id: "search-first", content: `Exact ${literalQuery}`, created_at: microseconds, sender_id: ids.self });
    const second = message({ id: "search-second", content: "Older literal result", created_at: "2026-01-02T03:04:05.123455+00:00" });
    await page.route("**/api/messages?**", async route => {
        const url = new URL(route.request().url());
        urls.push(url);
        await json(route, urls.length === 1
            ? { messages: [first], nextCursor: { createdAt: microseconds, id: first.id } }
            : { messages: [first, second], nextCursor: null });
    });
    const dialog = await openSearch(page);
    await dialog.getByRole("searchbox").fill(`  ${literalQuery}  `);
    await textVisible(dialog, first.content as string);
    await textVisible(dialog, en.you);
    await button(dialog, en.more).click();
    await textVisible(dialog, second.content as string);
    assert.equal(await dialog.getByRole("article").count(), 2);
    assert.equal(await button(dialog, en.more).count(), 0);
    assert.equal(urls.length, 2);
    assert.deepEqual(Object.fromEntries(urls[0].searchParams), { conversationId: ids.conversation, q: literalQuery });
    assert.deepEqual(Object.fromEntries(urls[1].searchParams), { conversationId: ids.conversation, q: literalQuery, beforeCreatedAt: microseconds, beforeId: first.id });
    await button(dialog.getByRole("article").first(), en.copy).click();
    await textVisible(dialog, en.copied);
    assert.deepEqual(await page.evaluate(() => (window as any).pulseFixture.clipboard.writes), [first.content]);
    await page.evaluate(() => { (window as any).pulseFixture.clipboard.fail = true; });
    await button(dialog.getByRole("article").last(), en.copy).click();
    await textVisible(dialog, en.copyFailed);
});

test("search aborts a stale response on query change and an in-flight request on close", async t => {
    const page = await harness.open(t);
    const gates = { old: deferred(), closing: deferred() };
    const arrivals = { old: deferred(), closing: deferred() };
    const completions = { old: deferred(), closing: deferred() };
    await page.route("**/api/messages?**", async route => {
        const query = new URL(route.request().url()).searchParams.get("q")!;
        if (query === "old" || query === "closing") {
            arrivals[query].resolve();
            await gates[query].promise;
            try { await json(route, { messages: [message({ content: "Stale result must never render" })], nextCursor: null }); }
            catch { /* Expected: browser aborted the request before route release. */ }
            finally { completions[query].resolve(); }
        } else await json(route, { messages: [message({ content: "Current result" })], nextCursor: null });
    });
    t.after(() => { gates.old.resolve(); gates.closing.resolve(); });
    const dialog = await openSearch(page);
    const input = dialog.getByRole("searchbox");
    await input.fill("old");
    await arrivals.old.promise;
    const oldAborted = page.waitForEvent("requestfailed", request => new URL(request.url()).searchParams.get("q") === "old");
    await input.fill("current");
    assert.match((await oldAborted).failure()?.errorText ?? "", /ABORTED|CANCELLED/i);
    await textVisible(dialog, "Current result");
    gates.old.resolve();
    await completions.old.promise;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await dialog.getByText("Stale result must never render").count(), 0);
    await textVisible(dialog, "Current result");
    await input.fill("closing");
    await arrivals.closing.promise;
    const closeAborted = page.waitForEvent("requestfailed", request => new URL(request.url()).searchParams.get("q") === "closing");
    await button(dialog, en.close).click();
    assert.match((await closeAborted).failure()?.errorText ?? "", /ABORTED|CANCELLED/i);
    gates.closing.resolve();
    await completions.closing.promise;
    await dialog.waitFor({ state: "hidden" });
});

test("incoming realtime edit updates a loaded OLD message outside newest 50", async t => {
    const page = await harness.open(t, { history: true });
    assert.equal(await row(page, ids.old).count(), 0, "Old message must not belong to newest page");
    await page.locator(".message-list").evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll", { bubbles: true })); });
    await row(page, ids.old).waitFor({ state: "attached" });
    const before = await page.evaluate(() => (window as any).pulseFixture.queries.filter((query: any) => query.table === "messages" && query.columns.includes("created_at")).length);
    const delivered = await page.evaluate(({ id }) => (window as any).pulseFixture.emitMessageUpdate(id, { content: "Realtime edited old text" }), { id: ids.old });
    assert.equal(delivered, 1, "Stored app realtime UPDATE callback must run exactly once");
    await bodyContains(row(page, ids.old), "Realtime edited old text");
    assert.equal(await page.evaluate(() => (window as any).pulseFixture.queries.filter((query: any) => query.table === "messages" && query.columns.includes("created_at")).length), before,
        "Old-row edit must apply from the realtime payload, not a newest-page reload");
});

test("MessageInput failed onSend keeps draft, retry succeeds once and clears", async t => {
    const page = await harness.open(t);
    const payloads: any[] = [];
    await page.route("**/api/messages", async route => {
        const payload = route.request().postDataJSON();
        payloads.push(payload);
        await json(route, payloads.length === 1 ? { error: "Synthetic send failure" } : { message: message({ id: payload.messageId, sender_id: ids.self, content: payload.content }) }, payloads.length === 1 ? 500 : 200);
    });
    const input = page.locator(".composer input");
    assert.equal(await button(page, en.send).isDisabled(), true);
    await input.fill("   ");
    assert.equal(await button(page, en.send).isDisabled(), true);
    await input.press("Enter");
    assert.equal(payloads.length, 0);
    assert.equal(await input.getAttribute("maxlength"), "4000");
    await input.fill("z".repeat(4001));
    assert.equal((await input.inputValue()).length, 4000);
    await input.fill("  Draft survives failure  ");
    await button(page, en.send).click();
    await textVisible(page, "Could not send. Try again.");
    assert.equal(await input.inputValue(), "  Draft survives failure  ");
    assert.equal(await page.locator(".message-row").filter({ hasText: "Draft survives failure" }).count(), 0);
    await button(page, en.send).click();
    await bodyContains(page.locator(".message-row").filter({ hasText: "Draft survives failure" }), "Draft survives failure");
    await page.waitForFunction(() => (document.querySelector(".composer input") as HTMLInputElement)?.value === "");
    assert.equal(payloads.length, 2);
    assert.equal(payloads[0].content, "Draft survives failure");
    assert.equal(payloads[1].content, payloads[0].content);
    assert.match(payloads[0].messageId, /^[a-f0-9-]{36}$/);
    assert.equal(payloads[1].messageId, payloads[0].messageId, "An identical retry must reuse its message ID");
    assert.equal(await button(page, en.send).isDisabled(), true);
});

test("MessageInput retries a persisted POST with a lost response without inserting twice", async t => {
    const page = await harness.open(t);
    const payloads: any[] = [];
    const persisted = new Map<string, ReturnType<typeof message>>();
    await page.route("**/api/messages", async route => {
        assert.equal(route.request().method(), "POST");
        const payload = route.request().postDataJSON();
        payloads.push(payload);
        if (!persisted.has(payload.messageId)) {
            persisted.set(payload.messageId, message({ id: payload.messageId, sender_id: ids.self, content: payload.content }));
        }
        // The server has committed the row, but the client never receives its response.
        if (payloads.length === 1) await route.abort("failed");
        else await json(route, { message: persisted.get(payload.messageId) });
    });
    const input = page.locator(".composer input");
    const content = "Persisted despite a lost response";
    await input.fill(content);
    await button(page, en.send).click();
    await textVisible(page, "Could not send. Try again.");
    assert.equal(await input.inputValue(), content);
    assert.equal(payloads.length, 1);
    assert.equal(persisted.size, 1, "The first POST must persist before its response is lost");
    assert.equal(await page.locator(".message-row").filter({ hasText: content }).count(), 0);
    await button(page, en.send).click();
    await bodyContains(page.locator(".message-row"), content);
    await page.waitForFunction(() => (document.querySelector(".composer input") as HTMLInputElement)?.value === "");
    assert.equal(payloads.length, 2);
    assert.match(payloads[0].messageId, /^[a-f0-9-]{36}$/);
    assert.equal(payloads[1].messageId, payloads[0].messageId);
    assert.deepEqual(payloads[1], payloads[0]);
    assert.equal(persisted.size, 1, "Retrying a committed POST must not create a second server row");
    assert.equal(await row(page, payloads[0].messageId).count(), 1);
    assert.equal(await page.locator(".message-row").filter({ hasText: content }).count(), 1);
});

test("MessageInput sending identical content after success allocates a fresh message ID", async t => {
    const page = await harness.open(t);
    const payloads: any[] = [];
    await page.route("**/api/messages", async route => {
        assert.equal(route.request().method(), "POST");
        const payload = route.request().postDataJSON();
        payloads.push(payload);
        await json(route, { message: message({ id: payload.messageId, sender_id: ids.self, content: payload.content }) });
    });
    const input = page.locator(".composer input");
    const content = "Intentional repeated message";
    await input.fill(content);
    await button(page, en.send).click();
    await page.waitForFunction(() => (document.querySelector(".composer input") as HTMLInputElement)?.value === "");
    assert.equal(payloads.length, 1);
    await bodyContains(row(page, payloads[0].messageId), content);
    await input.fill(content);
    await button(page, en.send).click();
    await page.waitForFunction(() => (document.querySelector(".composer input") as HTMLInputElement)?.value === "");
    assert.equal(payloads.length, 2);
    for (const payload of payloads) {
        assert.match(payload.messageId, /^[a-f0-9-]{36}$/);
        assert.equal(payload.content, content);
    }
    assert.notEqual(payloads[1].messageId, payloads[0].messageId, "Success must retire the previous idempotency key");
    await bodyContains(row(page, payloads[1].messageId), content);
    assert.equal(await page.locator(".message-row").filter({ hasText: content }).count(), 2);
});

test("MessageInput changing a failed draft allocates a fresh message ID", async t => {
    const page = await harness.open(t);
    const payloads: any[] = [];
    await page.route("**/api/messages", async route => {
        assert.equal(route.request().method(), "POST");
        const payload = route.request().postDataJSON();
        payloads.push(payload);
        await json(route, payloads.length === 1 ? { error: "Synthetic send failure" } : { message: message({ id: payload.messageId, sender_id: ids.self, content: payload.content }) }, payloads.length === 1 ? 500 : 200);
    });
    const input = page.locator(".composer input");
    const original = "Original failed draft";
    const changed = "Changed draft is a new message";
    await input.fill(original);
    await button(page, en.send).click();
    await textVisible(page, "Could not send. Try again.");
    assert.equal(await input.inputValue(), original);
    await input.fill(changed);
    await button(page, en.send).click();
    await bodyContains(page.locator(".message-row"), changed);
    await page.waitForFunction(() => (document.querySelector(".composer input") as HTMLInputElement)?.value === "");
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads.map(payload => payload.content), [original, changed]);
    for (const payload of payloads) assert.match(payload.messageId, /^[a-f0-9-]{36}$/);
    assert.notEqual(payloads[1].messageId, payloads[0].messageId, "A changed draft must not reuse the failed draft's idempotency key");
    assert.equal(await row(page, payloads[0].messageId).count(), 0);
    assert.equal(await row(page, payloads[1].messageId).count(), 1);
    assert.equal(await page.locator(".message-row").filter({ hasText: original }).count(), 0);
    assert.equal(await page.locator(".message-row").filter({ hasText: changed }).count(), 1);
});
