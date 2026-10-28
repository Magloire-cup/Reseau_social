export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_SEARCH_LENGTH = 200;
// Enough for two 4,000-character strings even when JSON escapes every character.
export const MAX_MESSAGE_REQUEST_BYTES = 64 * 1024;
export const MESSAGE_PAGE_SIZE = 50;

export class MessageValidationError extends Error {
    status: number;

    constructor(status = 400) {
        super(status === 413 ? "Requête trop volumineuse." : "Requête invalide.");
        this.name = "MessageValidationError";
        this.status = status;
    }
}

export type MessageCursor = { createdAt: string; id: string };
export type MessageQuery = { conversationId: string; query: string | null; cursor: MessageCursor | null };
export type TextMessageInput = {
    kind: "text";
    conversationId: string;
    messageId?: string;
    content: string;
    replyToId: string | null;
};
export type ForwardMessageInput = {
    kind: "forward";
    conversationId: string;
    messageId: string;
    forwardMessageId: string;
};
export type EditMessageInput = {
    conversationId: string;
    messageId: string;
    content: string;
    previousContent: string;
};

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new MessageValidationError();
    return value as Record<string, unknown>;
}

function onlyKeys(input: Record<string, unknown>, keys: string[]) {
    if (Object.keys(input).some((key) => !keys.includes(key))) throw new MessageValidationError();
}

export function validateMessageUuid(value: unknown): string {
    if (typeof value !== "string" || value.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        throw new MessageValidationError();
    }
    return value.toLowerCase();
}

function text(value: unknown, previous = false): string {
    if (typeof value !== "string" || value.length > MAX_MESSAGE_LENGTH || value.includes("\0")) {
        throw new MessageValidationError();
    }
    // The comparison value must stay byte-for-byte intact for optimistic concurrency.
    if (previous) return value;
    const content = value.trim();
    if (!content) throw new MessageValidationError();
    return content;
}

export function validatePostMessage(value: unknown): TextMessageInput | ForwardMessageInput {
    const input = record(value);
    const conversationId = validateMessageUuid(input.conversationId);
    if (Object.hasOwn(input, "forwardMessageId")) {
        onlyKeys(input, ["conversationId", "messageId", "forwardMessageId"]);
        return {
            kind: "forward",
            conversationId,
            messageId: validateMessageUuid(input.messageId),
            forwardMessageId: validateMessageUuid(input.forwardMessageId)
        };
    }
    onlyKeys(input, ["conversationId", "messageId", "content", "type", "replyToId"]);
    if (Object.hasOwn(input, "type") && input.type !== "text") throw new MessageValidationError();
    return {
        kind: "text",
        conversationId,
        messageId: Object.hasOwn(input, "messageId") ? validateMessageUuid(input.messageId) : undefined,
        content: text(input.content),
        replyToId: input.replyToId === undefined || input.replyToId === null ? null : validateMessageUuid(input.replyToId)
    };
}

export function validatePatchMessage(value: unknown): EditMessageInput {
    const input = record(value);
    onlyKeys(input, ["conversationId", "messageId", "content", "previousContent"]);
    return {
        conversationId: validateMessageUuid(input.conversationId),
        messageId: validateMessageUuid(input.messageId),
        content: text(input.content),
        previousContent: text(input.previousContent, true)
    };
}

export function validateCursorTimestamp(value: unknown): string {
    if (typeof value !== "string") throw new MessageValidationError();
    // PostgreSQL timestamps have microsecond precision. Never round-trip through Date.
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!match || match[0] !== value) throw new MessageValidationError();
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, , zoneHourText, zoneMinuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const zoneHour = Number(zoneHourText);
    const zoneMinute = Number(zoneMinuteText);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
        || Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59
        || (zone !== "Z" && (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)))) {
        throw new MessageValidationError();
    }
    return value;
}

export function validateMessageQuery(params: URLSearchParams): MessageQuery {
    for (const key of ["conversationId", "q", "beforeCreatedAt", "beforeId"]) {
        if (params.getAll(key).length > 1) throw new MessageValidationError();
    }
    const conversationId = validateMessageUuid(params.get("conversationId"));
    const query = params.has("q") ? params.get("q")!.trim() : null;
    if (query !== null && (!query || query.length > MAX_SEARCH_LENGTH)) throw new MessageValidationError();
    if (params.has("beforeCreatedAt") !== params.has("beforeId")) throw new MessageValidationError();
    const cursor = params.has("beforeCreatedAt") ? {
        createdAt: validateCursorTimestamp(params.get("beforeCreatedAt")),
        id: validateMessageUuid(params.get("beforeId"))
    } : null;
    return { conversationId, query, cursor };
}

export function literalMessageSearch(query: string): string {
    return query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function messageBeforeFilter(cursor: MessageCursor): string {
    // .or() is raw PostgREST syntax; validate both values at the composition boundary.
    const createdAt = validateCursorTimestamp(cursor.createdAt);
    const id = validateMessageUuid(cursor.id);
    return `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`;
}

export async function readMessageJson(request: Request): Promise<unknown> {
    const length = request.headers.get("content-length");
    if (length && /^\d+$/.test(length) && Number(length) > MAX_MESSAGE_REQUEST_BYTES) {
        throw new MessageValidationError(413);
    }
    if (!request.body) throw new MessageValidationError();
    const reader = request.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let body = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_MESSAGE_REQUEST_BYTES) {
                // Do not wait on an untrusted producer to acknowledge cancellation.
                void reader.cancel().catch(() => {});
                throw new MessageValidationError(413);
            }
            body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
        return JSON.parse(body) as unknown;
    } catch (error) {
        if (error instanceof MessageValidationError) throw error;
        throw new MessageValidationError();
    } finally {
        reader.releaseLock();
    }
}
