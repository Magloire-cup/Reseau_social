// Synthetic, deterministic data only. Shared by the browser fixture and Node tests.
export const ids = {
    self: "fixture-self", peer: "fixture-peer", destinationPeer: "fixture-destination-peer",
    conversation: "10000000-0000-4000-8000-000000000001",
    destination: "10000000-0000-4000-8000-000000000002",
    ai: "10000000-0000-4000-8000-000000000003",
    incoming: "20000000-0000-4000-8000-000000000001",
    outgoing: "20000000-0000-4000-8000-000000000002",
    deleted: "20000000-0000-4000-8000-000000000003",
    audio: "20000000-0000-4000-8000-000000000004",
    long: "20000000-0000-4000-8000-000000000005",
    old: "20000000-0000-4000-8000-000000000006"
};
export const initialContent = "Original outgoing text\nA second line.";
export const longContent = `Long multiline message\n${"unbroken".repeat(240)}\nLast line`;
export const microseconds = "2026-01-02T03:04:05.123456+00:00";
export const literalQuery = "%_\\.*[a]+?&= texte";
export function message(overrides: Record<string, unknown> = {}) {
    return {
        id: ids.incoming, conversation_id: ids.conversation, sender_id: ids.peer,
        content: "Incoming text", type: "text", status: "read", created_at: "2026-01-02T04:00:00.000001+00:00",
        reply_to_id: null, deleted_at: null, attachments: [], message_reactions: [], ...overrides
    };
}
export function seedMessages(history = false) {
    if (history) return [
        message({ id: ids.old, content: "Old incoming message", created_at: "2025-01-01T00:00:00.000001+00:00" }),
        ...Array.from({ length: 60 }, (_, index) => message({
            id: `history-${index}`, content: `Recent message ${index}`,
            created_at: `2026-01-02T04:${String(index).padStart(2, "0")}:00.000001+00:00`
        }))
    ];
    return [
        message(),
        message({ id: ids.outgoing, sender_id: ids.self, content: initialContent, created_at: "2026-01-02T04:01:00.000001+00:00" }),
        message({ id: ids.deleted, sender_id: ids.self, content: "", deleted_at: "2026-01-03T00:00:00Z", created_at: "2026-01-02T04:02:00.000001+00:00" }),
        message({ id: ids.audio, sender_id: ids.self, type: "audio", content: "", created_at: "2026-01-02T04:03:00.000001+00:00" }),
        message({ id: ids.long, sender_id: ids.self, content: longContent, created_at: "2026-01-02T04:04:00.000001+00:00" })
    ];
}
