import assert from "node:assert/strict";
import { test } from "node:test";
import {
    MAX_MESSAGE_REQUEST_BYTES,
    MessageValidationError,
    literalMessageSearch,
    messageBeforeFilter,
    readMessageJson,
    validateCursorTimestamp,
    validateMessageQuery,
    validateMessageUuid,
    validatePatchMessage,
    validatePostMessage
} from "../lib/message-validation.ts";

const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const forwardMessageId = "33333333-3333-4333-8333-333333333333";
const post = { conversationId, messageId, content: "hello" };
const patch = { ...post, previousContent: "before" };
const forward = { conversationId, messageId, forwardMessageId };
const invalid = (callback) => assert.throws(callback, (error) => error instanceof MessageValidationError && error.status === 400);
const request = (body, headers = {}) => new Request("https://pulse.invalid/api/messages", { method: "POST", body, headers });

for (const [name, value] of Object.entries({ null: null, array: [], number: 42, string: "hello", boolean: true, missing: undefined })) {
    test(`reject ${name} bodies in both write contracts`, () => {
        invalid(() => validatePostMessage(value));
        invalid(() => validatePatchMessage(value));
    });
}

test("UUIDs are canonical, case-normalized, and never coercible/injectable", () => {
    assert.equal(validateMessageUuid("ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF"), "abcdefab-cdef-4abc-8def-abcdefabcdef");
    for (const value of [null, 123, [], {}, "", ` ${messageId}`, `${messageId}\n`, messageId.replaceAll("-", ""), `${messageId},id.neq.0`, `${messageId})`, "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"]) {
        invalid(() => validateMessageUuid(value));
        invalid(() => validatePostMessage({ ...post, conversationId: value }));
        invalid(() => validatePostMessage({ ...post, messageId: value }));
        invalid(() => validatePatchMessage({ ...patch, messageId: value }));
    }
});

test("normal text sends trim content, allow generated IDs and nullable replies", () => {
    assert.deepEqual(validatePostMessage({ conversationId, content: "  hello\n", type: "text", replyToId: null }), {
        kind: "text", conversationId, messageId: undefined, content: "hello", replyToId: null
    });
    assert.equal(validatePostMessage({ ...post, replyToId: forwardMessageId }).replyToId, forwardMessageId);
    invalid(() => validatePostMessage({ ...post, replyToId: "not-a-uuid" }));
});

test("content types and raw 4,000-character limits are enforced without coercion", () => {
    for (const value of [null, false, 23, {}, [], "", " \n\t", "x".repeat(4001), "\0hello"]) {
        invalid(() => validatePostMessage({ ...post, content: value }));
        invalid(() => validatePatchMessage({ ...patch, content: value }));
    }
    assert.equal(validatePostMessage({ ...post, content: "x".repeat(4000) }).content.length, 4000);
    assert.equal(validatePatchMessage({ ...patch, content: "x".repeat(4000) }).content.length, 4000);
});

test("the text endpoint rejects voice, attachment, AI, and client-owned metadata", () => {
    for (const type of ["audio", "image", "file", "ai", "", null, 1]) invalid(() => validatePostMessage({ ...post, type }));
    for (const key of ["sender_id", "senderId", "status", "deleted_at", "attachments"]) {
        invalid(() => validatePostMessage({ ...post, [key]: "untrusted" }));
    }
});

test("edits require exact previousContent and accept only the four contract fields", () => {
    assert.equal(validatePatchMessage({ ...patch, previousContent: "  before\n" }).previousContent, "  before\n");
    assert.equal(validatePatchMessage({ ...patch, previousContent: "" }).previousContent, "");
    for (const value of [null, undefined, 123, {}, "x".repeat(4001)]) invalid(() => validatePatchMessage({ ...patch, previousContent: value }));
    for (const key of ["replyToId", "type", "forwardMessageId", "sender_id", "deleted_at", "edited_at"]) {
        invalid(() => validatePatchMessage({ ...patch, [key]: "untrusted" }));
    }
});

test("forwarding requires destination/optimistic/source IDs and no client content or reply", () => {
    assert.deepEqual(validatePostMessage(forward), { kind: "forward", ...forward });
    for (const key of ["content", "replyToId", "type", "sender_id", "author"]) {
        invalid(() => validatePostMessage({ ...forward, [key]: null }));
    }
    for (const key of ["conversationId", "messageId", "forwardMessageId"]) {
        const without = { ...forward };
        delete without[key];
        invalid(() => validatePostMessage(without));
        invalid(() => validatePostMessage({ ...forward, [key]: "x),or(id.neq.0" }));
    }
});

test("search is optional, trimmed, nonempty when supplied, and limited to 200", () => {
    assert.deepEqual(validateMessageQuery(new URLSearchParams({ conversationId })), { conversationId, query: null, cursor: null });
    assert.equal(validateMessageQuery(new URLSearchParams({ conversationId, q: "  find me  " })).query, "find me");
    assert.equal(validateMessageQuery(new URLSearchParams({ conversationId, q: "x".repeat(200) })).query.length, 200);
    for (const q of ["", "  ", "x".repeat(201)]) invalid(() => validateMessageQuery(new URLSearchParams({ conversationId, q })));
    invalid(() => validateMessageQuery(new URLSearchParams(`conversationId=${conversationId}&q=a&q=b`)));
    invalid(() => validateMessageQuery(new URLSearchParams()));
});

test("literal search escapes regex operators while percent and underscore stay literal", () => {
    assert.equal(literalMessageSearch("50%_\\off*"), "50%_\\\\off\\*");
    assert.equal(literalMessageSearch("a,b.(c)"), "a,b\\.\\(c\\)");
    assert.equal(literalMessageSearch("\\%"), "\\\\%");
    for (const character of ".*+?^${}()|[]\\") {
        assert.equal(literalMessageSearch(character), `\\${character}`);
    }
    for (const query of ["a*b", "50%_off", "[a-z]+", "(?i).*", "x),or(id.neq.0", "a\\b", "a\nb"]) {
        const pattern = new RegExp(literalMessageSearch(query), "i");
        assert.ok(pattern.test(`before ${query} after`));
        assert.equal(pattern.test("unrelated content"), false);
    }
});

test("cursor validates dates, preserves microseconds and accepts explicit timezone offsets", () => {
    for (const timestamp of ["2026-09-28T12:34:56.123456Z", "2026-09-28T12:34:56.000001+00:00", "2024-02-29T23:59:59-05:30", "2000-02-29T00:00:00Z", "2026-01-01T00:00:00.1+14:00"]) {
        assert.equal(validateCursorTimestamp(timestamp), timestamp);
    }
    for (const timestamp of [null, 42, "", "2026-09-28", "2026-09-28T12:00:00", "2026-02-29T00:00:00Z", "1900-02-29T00:00:00Z", "0000-01-01T00:00:00Z", "2026-13-01T00:00:00Z", "2026-04-31T00:00:00Z", "2026-01-00T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T00:60:00Z", "2026-01-01T00:00:60Z", "2026-01-01T00:00:00+14:01", "2026-01-01T00:00:00+00:60", "2026-01-01T00:00:00.1234567Z", "2026-01-01T00:00:00Z,id.neq.0", "2026-01-01T00:00:00Z\n"]) {
        invalid(() => validateCursorTimestamp(timestamp));
    }
});

test("keyset cursors require both fields and compose the timestamp/ID tie-break safely", () => {
    const createdAt = "2026-09-28T12:34:56.123456+00:00";
    const params = new URLSearchParams({ conversationId, beforeCreatedAt: createdAt, beforeId: messageId });
    assert.deepEqual(validateMessageQuery(params).cursor, { createdAt, id: messageId });
    assert.equal(messageBeforeFilter({ createdAt, id: messageId }), `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${messageId})`);
    for (const key of ["beforeCreatedAt", "beforeId"]) {
        const incomplete = new URLSearchParams(params);
        incomplete.delete(key);
        invalid(() => validateMessageQuery(incomplete));
    }
    invalid(() => messageBeforeFilter({ createdAt: `${createdAt}),id.neq.0`, id: messageId }));
    invalid(() => messageBeforeFilter({ createdAt, id: `${messageId},id.neq.0` }));
});

test("JSON reader handles valid, malformed, empty, and invalid UTF-8 bodies", async () => {
    assert.deepEqual(await readMessageJson(request(JSON.stringify(post))), post);
    for (const body of ["", "{", "undefined", new Uint8Array([0xff])]) {
        await assert.rejects(readMessageJson(request(body)), { status: 400 });
    }
    await assert.rejects(readMessageJson(new Request("https://pulse.invalid", { method: "POST" })), { status: 400 });
});

test("body byte limit rejects oversized headers and actual bytes even with false/missing headers", async () => {
    await assert.rejects(readMessageJson(request("{}", { "content-length": String(MAX_MESSAGE_REQUEST_BYTES + 1) })), { status: 413 });
    for (const headers of [{}, { "content-length": "2" }]) {
        await assert.rejects(readMessageJson(request("x".repeat(MAX_MESSAGE_REQUEST_BYTES + 1), headers)), { status: 413 });
        await assert.rejects(readMessageJson(request("é".repeat(MAX_MESSAGE_REQUEST_BYTES / 2 + 1), headers)), { status: 413 });
    }
    assert.equal(await readMessageJson(request(`"${"a".repeat(MAX_MESSAGE_REQUEST_BYTES - 2)}"`)), "a".repeat(MAX_MESSAGE_REQUEST_BYTES - 2));
});

test("streamed JSON preserves split UTF-8 characters and cancels oversized streams", async () => {
    const encoded = new TextEncoder().encode('{"content":"é"}');
    const stream = new ReadableStream({ start(controller) {
        for (const byte of encoded) controller.enqueue(new Uint8Array([byte]));
        controller.close();
    } });
    assert.deepEqual(await readMessageJson(new Request("https://pulse.invalid", { method: "POST", body: stream, duplex: "half" })), { content: "é" });
    let cancelled = false;
    const oversized = new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(MAX_MESSAGE_REQUEST_BYTES + 1)); },
        cancel() { cancelled = true; }
    });
    await assert.rejects(readMessageJson(new Request("https://pulse.invalid", { method: "POST", body: oversized, duplex: "half" })), { status: 413 });
    assert.equal(cancelled, true);
});
