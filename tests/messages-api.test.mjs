import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createClient } from "@supabase/supabase-js";

// This test process alone resolves extensionless Next imports and stubs auth/client creation.
// Use the real Supabase query builder with an in-memory HTTP transport; no auth keys or DB.
const serverUrl = new URL("../lib/supabase/server.ts", import.meta.url).href;
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "../../../lib/supabase/server") return { url: serverUrl, shortCircuit: true };
        if (specifier === "../../../lib/message-validation") return { url: new URL("../lib/message-validation.ts", import.meta.url).href, shortCircuit: true };
        return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
    }
});

let userId;
let available;
let authError;
let steps;
let events;
let transportFailures;
const client = createClient("https://pulse.invalid", "test-publishable-key", {
    accessToken: async () => "test-caller-jwt",
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
        try {
            const url = new URL(input instanceof Request ? input.url : input);
            const headers = new Headers(init?.headers);
            const method = init?.method ?? "GET";
            events.push(`db:${url.pathname.split("/").at(-1)}:${method}`);
            const step = steps.shift();
            assert.ok(step, `Unexpected ${method} ${url}`);
            assert.equal(url.hostname, "pulse.invalid");
            assert.equal(url.pathname, `/rest/v1/${step.table}`);
            assert.equal(method, step.method ?? "GET");
            assert.equal(headers.get("authorization"), "Bearer test-caller-jwt");
            step.check?.(url.searchParams, init?.body ? JSON.parse(init.body) : null, headers);
            return new Response(JSON.stringify(step.data), { status: step.status ?? 200, headers: { "content-type": "application/json" } });
        } catch (error) {
            transportFailures.push(error);
            throw error;
        }
    } }
});
mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network access is forbidden in backend tests"); });
mock.module("@clerk/nextjs/server", { namedExports: { auth: async () => {
    events.push("auth");
    if (authError) throw authError;
    return { userId };
} } });
mock.module(serverUrl, { namedExports: { createServerSupabase: async () => {
    events.push("client");
    return available ? client : null;
} } });
const { GET, POST, PATCH } = await import("../app/api/messages/route.ts");

const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const sourceConversationId = "44444444-4444-4444-8444-444444444444";
const createdAt = "2026-09-28T12:34:56.123456+00:00";
const fields = "id,conversation_id,sender_id,content,type,status,created_at,reply_to_id,deleted_at";
const row = (overrides = {}) => ({ id: messageId, conversation_id: conversationId, sender_id: "user_test", content: "hello", type: "text", status: "sent", created_at: createdAt, reply_to_id: null, deleted_at: null, ...overrides });
const post = { conversationId, messageId, content: "hello" };
const patch = { ...post, previousContent: "before" };
const forward = { conversationId, messageId, forwardMessageId: sourceId };
const getRequest = (params = {}) => new Request(`https://pulse.invalid/api/messages?${new URLSearchParams({ conversationId, ...params })}`);
const writeRequest = (method, body) => new Request("https://pulse.invalid/api/messages", { method, body: JSON.stringify(body) });
const dbError = (code = "XX000") => ({ code, message: "PRIVATE database details / credential", details: "secret", hint: "secret" });

beforeEach(() => {
    userId = "user_test";
    available = true;
    authError = null;
    steps = [];
    events = [];
    transportFailures = [];
});
afterEach(() => {
    assert.deepEqual(transportFailures, []);
    assert.equal(steps.length, 0, "Every expected database query must run");
});

function membership(data = [{ conversation_id: conversationId }]) {
    steps.push({ table: "conversation_members", data, check(params) {
        assert.equal(params.get("select"), "conversation_id");
        assert.equal(params.get("conversation_id"), `eq.${conversationId}`);
        assert.equal(params.get("user_id"), "eq.user_test");
    } });
}
function destination(type = "group") {
    steps.push({ table: "conversations", data: type === null ? [] : [{ type }], check(params) {
        assert.equal(params.get("select"), "type");
        assert.equal(params.get("id"), `eq.${conversationId}`);
    } });
}
function sourceMembership(found = true) {
    steps.push({ table: "conversation_members", data: found ? [{ conversation_id: sourceConversationId }] : [], check(params) {
        assert.equal(params.get("select"), "conversation_id,conversations!inner(messages!inner(id))");
        assert.equal(params.get("user_id"), "eq.user_test");
        assert.equal(params.get("conversations.messages.id"), `eq.${sourceId}`);
    } });
}
function source(content = "server source", found = true) {
    steps.push({ table: "messages", data: found ? [{ content }] : [], check(params) {
        assert.equal(params.get("select"), "content");
        assert.equal(params.get("id"), `eq.${sourceId}`);
        assert.equal(params.get("conversation_id"), `eq.${sourceConversationId}`);
        assert.equal(params.get("type"), "eq.text");
        assert.equal(params.get("deleted_at"), "is.null");
    } });
}
function insert({ content = "hello", replyToId = null, data = row({ content, reply_to_id: replyToId }), status = 201, generatedId = false } = {}) {
    steps.push({ table: "messages", method: "POST", data, status, check(params, body) {
        assert.equal(params.get("select"), fields);
        assert.deepEqual(body, {
            ...(generatedId ? {} : { id: messageId }), conversation_id: conversationId, sender_id: "user_test",
            content, type: "text", status: "sent", reply_to_id: replyToId
        });
    } });
}
function duplicate(data = [row()]) {
    steps.push({ table: "messages", data, check(params) {
        assert.equal(params.get("select"), fields);
        assert.equal(params.get("id"), `eq.${messageId}`);
        assert.equal(params.get("conversation_id"), `eq.${conversationId}`);
        assert.equal(params.get("sender_id"), "eq.user_test");
    } });
}
async function responseIs(response, status) {
    assert.equal(response.status, status);
    const body = await response.json();
    if (status >= 400) {
        assert.equal(typeof body.error, "string");
        assert.doesNotMatch(JSON.stringify(body), /PRIVATE|credential|secret/);
    }
    return body;
}

for (const [method, handler] of Object.entries({ GET, POST, PATCH })) {
    test(`${method}: authenticate before parsing, client creation or queries`, async () => {
        userId = null;
        const request = method === "GET" ? getRequest({ conversationId: "invalid" }) : new Request("https://pulse.invalid", { method, body: "{" });
        await responseIs(await handler(request), 401);
        assert.deepEqual(events, ["auth"]);
    });
    test(`${method}: unavailable caller client returns 503`, async () => {
        available = false;
        await responseIs(await handler(method === "GET" ? getRequest() : writeRequest(method, method === "POST" ? post : patch)), 503);
        assert.deepEqual(events, ["auth", "client"]);
    });
    test(`${method}: missing/nonmember conversation is 404 before message queries`, async () => {
        membership([]);
        await responseIs(await handler(method === "GET" ? getRequest() : writeRequest(method, method === "POST" ? post : patch)), 404);
        assert.deepEqual(events, ["auth", "client", "db:conversation_members:GET"]);
    });
    test(`${method}: authentication exceptions are safely hidden`, async () => {
        authError = new Error("PRIVATE authentication credential");
        await responseIs(await handler(method === "GET" ? getRequest() : writeRequest(method, post)), 500);
        assert.deepEqual(events, ["auth"]);
    });
}

for (const [method, handler] of Object.entries({ POST, PATCH })) {
    test(`${method}: malformed JSON, primitive bodies, and oversized requests are rejected before DB`, async () => {
        for (const body of ["{", "null", "[]", "123", '"hello"']) {
            await responseIs(await handler(new Request("https://pulse.invalid", { method, body })), 400);
        }
        await responseIs(await handler(new Request("https://pulse.invalid", { method, body: "x".repeat(65537) })), 413);
        assert.ok(events.every((event) => event === "auth"));
    });
}

test("GET: invalid IDs, search and cursor syntax never reach Supabase", async () => {
    for (const params of [{ conversationId: `${conversationId},id.neq.0` }, { q: " " }, { q: "x".repeat(201) }, { beforeId: messageId }, { beforeCreatedAt: `${createdAt}),id.neq.0`, beforeId: messageId }]) {
        await responseIs(await GET(getRequest(params)), 400);
    }
    assert.ok(events.every((event) => event === "auth"));
});

test("GET: descending 50+1 keyset pages preserve microsecond timestamps and tied IDs", async () => {
    const rows = Array.from({ length: 52 }, (_, index) => row({ id: `55555555-5555-4555-8555-${String(100 - index).padStart(12, "0")}` }));
    membership();
    steps.push({ table: "messages", data: rows.slice(0, 51), check(params) {
        assert.equal(params.get("select"), fields);
        assert.equal(params.get("conversation_id"), `eq.${conversationId}`);
        assert.equal(params.get("order"), "created_at.desc,id.desc");
        assert.equal(params.get("limit"), "51");
        assert.equal(params.has("or"), false);
    } });
    const first = await responseIs(await GET(getRequest()), 200);
    assert.deepEqual(first.messages, rows.slice(0, 50));
    assert.deepEqual(first.nextCursor, { createdAt, id: rows[49].id });
    membership();
    steps.push({ table: "messages", data: rows.slice(50), check(params) {
        assert.equal(params.get("or"), `(created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${rows[49].id}))`);
        assert.equal(params.get("order"), "created_at.desc,id.desc");
        assert.equal(params.get("limit"), "51");
    } });
    const second = await responseIs(await GET(getRequest({ beforeCreatedAt: first.nextCursor.createdAt, beforeId: first.nextCursor.id })), 200);
    assert.deepEqual([...first.messages, ...second.messages], rows);
    assert.equal(second.nextCursor, null);
});

test("GET: literal search includes only undeleted text and an empty result has no cursor", async () => {
    membership();
    steps.push({ table: "messages", data: [], check(params) {
        assert.equal(params.get("type"), "eq.text");
        assert.equal(params.get("deleted_at"), "is.null");
        assert.equal(params.get("content"), "imatch.50%_\\\\off\\*");
    } });
    assert.deepEqual(await responseIs(await GET(getRequest({ q: " 50%_\\off* " })), 200), { messages: [], nextCursor: null });
});

test("GET: exactly 50 rows is the final page", async () => {
    membership();
    steps.push({ table: "messages", data: Array.from({ length: 50 }, () => row()) });
    assert.equal((await responseIs(await GET(getRequest()), 200)).nextCursor, null);
});

test("GET: database errors have generic safe responses", async () => {
    membership();
    steps.push({ table: "messages", data: dbError(), status: 500 });
    await responseIs(await GET(getRequest()), 500);
});

test("membership policy denial is indistinguishable from a missing conversation", async () => {
    steps.push({ table: "conversation_members", data: dbError("42501"), status: 403 });
    await responseIs(await GET(getRequest()), 404);
});

test("PATCH: atomic author/conversation/type/deletion/previous-content guard changes only content", async () => {
    membership();
    steps.push({ table: "messages", method: "PATCH", data: [row({ content: "after" })], check(params, body) {
        assert.deepEqual(body, { content: "after" });
        assert.equal(params.get("id"), `eq.${messageId}`);
        assert.equal(params.get("conversation_id"), `eq.${conversationId}`);
        assert.equal(params.get("sender_id"), "eq.user_test");
        assert.equal(params.get("type"), "eq.text");
        assert.equal(params.get("deleted_at"), "is.null");
        assert.equal(params.get("content"), "eq.  exact before\n");
        assert.equal(params.get("select"), fields);
    } });
    assert.equal((await responseIs(await PATCH(writeRequest("PATCH", { ...patch, content: " after ", previousContent: "  exact before\n" })), 200)).message.content, "after");
});

for (const reason of ["changed content", "other author", "another conversation", "deleted", "audio", "missing"]) {
    test(`PATCH: ${reason} yields 409 when atomic update matches no eligible row`, async () => {
        membership();
        steps.push({ table: "messages", method: "PATCH", data: [] });
        await responseIs(await PATCH(writeRequest("PATCH", patch)), 409);
    });
}

test("PATCH: RLS denial is ineligible, other DB errors stay generic", async () => {
    for (const [code, expected] of [["42501", 409], ["XX000", 500]]) {
        membership();
        steps.push({ table: "messages", method: "PATCH", data: dbError(code), status: 403 });
        await responseIs(await PATCH(writeRequest("PATCH", patch)), expected);
    }
});

test("PATCH: PostgREST's zero-row object response is normalized to 409", async () => {
    membership();
    steps.push({ table: "messages", method: "PATCH", status: 406, data: {
        code: "PGRST116", message: "Cannot coerce the result to a single JSON object", details: "The result contains 0 rows", hint: null
    } });
    await responseIs(await PATCH(writeRequest("PATCH", patch)), 409);
});

test("POST: normal text binds caller identity and returns only selected metadata", async () => {
    membership();
    insert();
    assert.deepEqual(await responseIs(await POST(writeRequest("POST", { ...post, content: " hello ", type: "text" })), 201), { message: row() });
});

test("POST: missing optimistic ID lets PostgreSQL generate the UUID", async () => {
    membership();
    insert({ generatedId: true });
    await responseIs(await POST(writeRequest("POST", { conversationId, content: "hello" })), 201);
});

test("POST: replies must point to an undeleted message in the authorized conversation", async () => {
    for (const found of [true, false]) {
        membership();
        steps.push({ table: "messages", data: found ? [{ id: sourceId }] : [], check(params) {
            assert.equal(params.get("select"), "id");
            assert.equal(params.get("id"), `eq.${sourceId}`);
            assert.equal(params.get("conversation_id"), `eq.${conversationId}`);
            assert.equal(params.get("deleted_at"), "is.null");
        } });
        if (found) insert({ replyToId: sourceId });
        await responseIs(await POST(writeRequest("POST", { ...post, replyToId: sourceId })), found ? 201 : 404);
    }
});

test("POST: duplicate optimistic IDs return the owned, identical existing payload", async () => {
    membership();
    insert({ data: dbError("23505"), status: 409 });
    duplicate([row({ status: "read" })]);
    assert.equal((await responseIs(await POST(writeRequest("POST", post)), 200)).message.status, "read");
});

for (const [reason, existing] of [
    ["different content", [row({ content: "changed" })]],
    ["different reply", [row({ reply_to_id: sourceId })]],
    ["different type", [row({ type: "audio" })]],
    ["deleted", [row({ deleted_at: createdAt })]],
    ["another author/conversation or hidden row", []]
]) {
    test(`POST: duplicate ID with ${reason} returns 409`, async () => {
        membership();
        insert({ data: dbError("23505"), status: 409 });
        duplicate(existing);
        await responseIs(await POST(writeRequest("POST", post)), 409);
    });
}

test("POST: rejects attachment, forward/edit mixtures, and spoofed source metadata before DB", async () => {
    for (const body of [{ ...post, type: "audio" }, { ...forward, content: "client forgery" }, { ...forward, replyToId: sourceId }, { ...forward, sender_id: "user_forged" }, { ...patch, deleted_at: null }]) {
        await responseIs(await POST(writeRequest("POST", body)), 400);
    }
    assert.ok(events.every((event) => event === "auth"));
});

test("POST forward: checks both memberships and copies only exact server-fetched text", async () => {
    membership();
    destination();
    sourceMembership();
    source("  server source\n");
    insert({ content: "  server source\n" });
    const body = await responseIs(await POST(writeRequest("POST", forward)), 201);
    assert.equal(body.message.content, "  server source\n");
    assert.equal(body.message.sender_id, "user_test");
    assert.equal(body.message.reply_to_id, null);
    assert.deepEqual(events, ["auth", "client", "db:conversation_members:GET", "db:conversations:GET", "db:conversation_members:GET", "db:messages:GET", "db:messages:POST"]);
});

test("POST forward: AI and nonexistent destinations are rejected before source access", async () => {
    for (const type of ["ai", null]) {
        membership();
        destination(type);
        await responseIs(await POST(writeRequest("POST", forward)), type === "ai" ? 400 : 404);
    }
});

test("POST forward: a source hidden by RLS or without explicit membership is 404", async () => {
    membership();
    destination("direct");
    sourceMembership(false);
    await responseIs(await POST(writeRequest("POST", forward)), 404);
});

test("POST forward: deleted/non-text/missing source cannot be forwarded", async () => {
    membership();
    destination();
    sourceMembership();
    source("", false);
    await responseIs(await POST(writeRequest("POST", forward)), 404);
});

test("POST forward: identical optimistic retry returns existing text without metadata additions", async () => {
    membership();
    destination();
    sourceMembership();
    source("hello");
    insert({ data: dbError("23505"), status: 409 });
    duplicate();
    assert.deepEqual(await responseIs(await POST(writeRequest("POST", forward)), 200), { message: row() });
});

test("POST: blocked-chat INSERT RLS denies normal and forwarded messages with 403", async () => {
    for (const body of [post, forward]) {
        membership();
        if (body === forward) {
            destination();
            sourceMembership();
            source("hello");
        }
        insert({ data: dbError("42501"), status: 403 });
        await responseIs(await POST(writeRequest("POST", body)), 403);
    }
});

test("POST: unexpected insert errors never expose database internals", async () => {
    membership();
    insert({ data: dbError(), status: 500 });
    await responseIs(await POST(writeRequest("POST", post)), 500);
});
