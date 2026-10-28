// Test-only module replacements. No SDK, credentials, tokens, or network clients.
import { ids, seedMessages } from "./seed";

type Row = Record<string, any>;
type Filter = { operation: string; column: string; value: any };
const params = new URLSearchParams(location.search);
const messages: Row[] = seedMessages(params.has("history"));
const profiles = [
    { id: ids.self, name: "Fixture Self", username: "fixture-self", avatar: null, online: false },
    { id: ids.peer, name: "Fixture Friend", username: "fixture-friend", avatar: null, online: false },
    { id: ids.destinationPeer, name: "Fixture Destination", username: "fixture-destination", avatar: null, online: false }
];
const conversations = [
    { id: ids.conversation, type: "direct", name: "Fixture Friend", peer: profiles[1] },
    { id: ids.destination, type: "direct", name: "Fixture Destination", peer: profiles[2] },
    { id: ids.ai, type: "ai", name: "Gemini AI", peer: null }
];
export const queries: { table: string; columns: string; filters: Filter[] }[] = [];
class Query {
    columns = "*";
    filters: Filter[] = [];
    limitCount = Infinity;
    ascending = true;
    orderColumn: string | null = null;
    single = false;
    mutation = false;
    table: string;
    constructor(table: string) { this.table = table; }
    select(columns = "*") { this.columns = columns; return this; }
    eq(column: string, value: any) { this.filters.push({ operation: "eq", column, value }); return this; }
    neq(column: string, value: any) { this.filters.push({ operation: "neq", column, value }); return this; }
    lt(column: string, value: any) { this.filters.push({ operation: "lt", column, value }); return this; }
    in(column: string, value: any[]) { this.filters.push({ operation: "in", column, value }); return this; }
    order(column: string, options: Row = {}) {
        if (!options.referencedTable) { this.orderColumn = column; this.ascending = options.ascending !== false; }
        return this;
    }
    limit(count: number, options: Row = {}) { if (!options.referencedTable) this.limitCount = count; return this; }
    maybeSingle() { this.single = true; return this; }
    update() { return this.presenceOnly(); }
    upsert() { return this.presenceOnly(); }
    presenceOnly() {
        if (this.table !== "users") throw new Error(`Unexpected fixture mutation: ${this.table}`);
        this.mutation = true;
        return this;
    }
    result() {
        queries.push({ table: this.table, columns: this.columns, filters: [...this.filters] });
        if (this.mutation) return { data: null, error: null };
        let rows: Row[];
        if (this.table === "users") rows = profiles;
        else if (this.table === "messages") rows = messages;
        else if (this.table === "blocks") rows = [];
        else if (this.table === "conversation_members") rows = conversations.map(conversation => ({
            user_id: ids.self, conversation_id: conversation.id,
            conversations: {
                ...conversation, created_at: "2026-01-01T00:00:00Z",
                messages: messages.filter(row => row.conversation_id === conversation.id).slice(-1),
                conversation_members: [profiles[0], conversation.peer].filter(Boolean).map(users => ({ users }))
            }
        }));
        else throw new Error(`Unimplemented fixture table: ${this.table}`);
        const field = (row: Row, column: string) => column.split(".").reduce((value, key) => value?.[key], row);
        rows = rows.filter(row => this.filters.every(({ operation, column, value }) => {
            const current = field(row, column);
            if (operation === "eq") return current === value;
            if (operation === "neq") return current !== null && current !== value;
            if (operation === "lt") return current < value;
            if (operation === "in") return value.includes(current);
            throw new Error(`Unimplemented filter: ${operation}`);
        }));
        if (this.orderColumn) {
            const column = this.orderColumn;
            rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (this.ascending ? 1 : -1));
        }
        rows = rows.slice(0, this.limitCount);
        return { data: this.single ? rows[0] ?? null : rows, error: null };
    }
    then(resolve: (value: any) => any, reject?: (error: any) => any) {
        return Promise.resolve().then(() => this.result()).then(resolve, reject);
    }
}

type Handler = { kind: string; filter: Row; callback: (payload: Row) => void };
const channels = new Set<Channel>();
class Channel {
    handlers: Handler[] = [];
    on(kind: string, filter: Row, callback: (payload: Row) => void) { this.handlers.push({ kind, filter, callback }); return this; }
    subscribe() { channels.add(this); return this; }
    send() { return Promise.resolve("ok"); }
}
const client = {
    from: (table: string) => new Query(table),
    rpc: async (name: string) => {
        if (name === "mark_conversation_read") return { data: 0, error: null };
        if (name === "conversation_is_blocked") return { data: false, error: null };
        throw new Error(`Unimplemented fixture RPC: ${name}`);
    },
    channel: () => new Channel(),
    removeChannel: (channel: Channel) => { channels.delete(channel); return Promise.resolve(); },
    realtime: { setAuth: () => { throw new Error("Fixture must never supply a token"); } },
    storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) }
};
export function createClient() { return client; }
// Pulse registers a provider; this mock never invokes it or produces a token.
export function setSupabaseTokenProvider() {}
const auth = { isLoaded: true, getToken: async () => null };
const user = { user: { id: ids.self } };
export function useAuth() { return auth; }
export function useUser() { return user; }
export function useClerk() { return { signOut: async () => { throw new Error("Auth is outside this fixture"); } }; }
export function useVoiceCall() { return { phase: "idle" }; }
export function useInstallPrompt() { return { canInstall: false, installed: false, platform: "desktop" }; }
export async function askGemini() { throw new Error("AI is outside this fixture"); }
export function ProfileModal() { throw new Error("Profile is outside this fixture"); }
export function ContactProfileModal() { throw new Error("Profile is outside this fixture"); }
export function AuthScreen() { throw new Error("Fixture identity must already be loaded"); }
export function CallOverlay() { throw new Error("Calls are outside this fixture"); }
export function CallLog() { throw new Error("Calls are outside this fixture"); }

export function emitMessageUpdate(id: string, changes: Row) {
    const row = messages.find(message => message.id === id);
    if (!row) throw new Error(`Unknown fixture message: ${id}`);
    const old = { ...row };
    Object.assign(row, changes);
    let delivered = 0;
    for (const channel of channels) for (const handler of channel.handlers) {
        if (handler.kind === "postgres_changes" && handler.filter.table === "messages" && ["UPDATE", "*"].includes(handler.filter.event)) {
            handler.callback({ new: { ...row }, old, eventType: "UPDATE" });
            delivered++;
        }
    }
    return delivered;
}
