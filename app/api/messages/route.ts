import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";
import {
    MESSAGE_PAGE_SIZE,
    MessageValidationError,
    literalMessageSearch,
    messageBeforeFilter,
    readMessageJson,
    validateMessageQuery,
    validatePatchMessage,
    validatePostMessage
} from "../../../lib/message-validation";

const messageFields = "id, conversation_id, sender_id, content, type, status, created_at, reply_to_id, deleted_at";
type Supabase = NonNullable<Awaited<ReturnType<typeof createServerSupabase>>>;

class MessageApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

function failure(error: unknown) {
    if (error instanceof MessageValidationError || error instanceof MessageApiError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Impossible de traiter les messages." }, { status: 500 });
}

async function requireMembership(supabase: Supabase, conversationId: string, userId: string) {
    const result = await supabase.from("conversation_members").select("conversation_id")
        .eq("conversation_id", conversationId).eq("user_id", userId).maybeSingle();
    if (result.error && result.error.code !== "42501") throw result.error;
    if (result.error || !result.data) throw new MessageApiError(404, "Conversation introuvable.");
}

export async function GET(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) throw new MessageApiError(401, "Authentification requise.");
        const input = validateMessageQuery(new URL(request.url).searchParams);
        const supabase = await createServerSupabase();
        if (!supabase) throw new MessageApiError(503, "Service de messages indisponible.");
        await requireMembership(supabase, input.conversationId, userId);

        let query = supabase.from("messages").select(messageFields).eq("conversation_id", input.conversationId)
            .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(MESSAGE_PAGE_SIZE + 1);
        if (input.query !== null) {
            // Unlike ilike, imatch does not reinterpret literal asterisks as SQL wildcards.
            query = query.eq("type", "text").is("deleted_at", null).regexIMatch("content", literalMessageSearch(input.query));
        }
        if (input.cursor) query = query.or(messageBeforeFilter(input.cursor));
        const result = await query;
        if (result.error) throw result.error;
        const rows = result.data ?? [];
        const messages = rows.slice(0, MESSAGE_PAGE_SIZE);
        const last = messages[messages.length - 1];
        const nextCursor = rows.length > MESSAGE_PAGE_SIZE ? { createdAt: last.created_at, id: last.id } : null;
        return NextResponse.json({ messages, nextCursor });
    } catch (error) {
        return failure(error);
    }
}

export async function PATCH(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) throw new MessageApiError(401, "Authentification requise.");
        const input = validatePatchMessage(await readMessageJson(request));
        const supabase = await createServerSupabase();
        if (!supabase) throw new MessageApiError(503, "Service de messages indisponible.");
        await requireMembership(supabase, input.conversationId, userId);

        // Eligibility and previousContent are checked by the same UPDATE: no read/write race,
        // no status change, and no resurrection after a concurrent soft deletion.
        const result = await supabase.from("messages").update({ content: input.content })
            .eq("id", input.messageId).eq("conversation_id", input.conversationId).eq("sender_id", userId)
            .eq("type", "text").is("deleted_at", null).eq("content", input.previousContent)
            .select(messageFields).maybeSingle();
        // The primary-key predicate permits at most one row; a singular-result error
        // therefore also means no eligible row (including older PostgREST responses).
        if (result.error && result.error.code !== "42501" && result.error.code !== "PGRST116") throw result.error;
        if (result.error || !result.data) throw new MessageApiError(409, "Message modifié ou non modifiable.");
        return NextResponse.json({ message: result.data });
    } catch (error) {
        return failure(error);
    }
}

export async function POST(request: Request) {
    try {
        const { userId } = await auth();
        if (!userId) throw new MessageApiError(401, "Authentification requise.");
        const input = validatePostMessage(await readMessageJson(request));
        const supabase = await createServerSupabase();
        if (!supabase) throw new MessageApiError(503, "Service de messages indisponible.");
        await requireMembership(supabase, input.conversationId, userId);

        let content: string;
        let replyToId: string | null = null;
        if (input.kind === "forward") {
            const destination = await supabase.from("conversations").select("type")
                .eq("id", input.conversationId).maybeSingle();
            if (destination.error) throw destination.error;
            if (!destination.data) throw new MessageApiError(404, "Conversation introuvable.");
            if (destination.data.type !== "direct" && destination.data.type !== "group") {
                throw new MessageApiError(400, "Transfert non autorisé vers cette conversation.");
            }

            // Discover the source through the caller's membership, not an unrestricted message
            // lookup. Both inner joins are necessary to filter the top-level membership row.
            const sourceMembership = await supabase.from("conversation_members")
                .select("conversation_id, conversations!inner(messages!inner(id))")
                .eq("user_id", userId).eq("conversations.messages.id", input.forwardMessageId).maybeSingle();
            if (sourceMembership.error && sourceMembership.error.code !== "42501") throw sourceMembership.error;
            if (sourceMembership.error || !sourceMembership.data) throw new MessageApiError(404, "Message source introuvable.");
            const source = await supabase.from("messages").select("content")
                .eq("id", input.forwardMessageId).eq("conversation_id", sourceMembership.data.conversation_id)
                .eq("type", "text").is("deleted_at", null).maybeSingle();
            if (source.error) throw source.error;
            if (!source.data) throw new MessageApiError(404, "Message source introuvable.");
            content = source.data.content;
        } else {
            content = input.content;
            replyToId = input.replyToId;
            if (replyToId) {
                const target = await supabase.from("messages").select("id")
                    .eq("id", replyToId).eq("conversation_id", input.conversationId).is("deleted_at", null).maybeSingle();
                if (target.error) throw target.error;
                if (!target.data) throw new MessageApiError(404, "Message cité introuvable.");
            }
        }

        // Always the caller-JWT client: INSERT RLS remains responsible for blocked chats.
        const result = await supabase.from("messages").insert({
            ...(input.messageId ? { id: input.messageId } : {}),
            conversation_id: input.conversationId,
            sender_id: userId,
            content,
            type: "text",
            status: "sent",
            reply_to_id: replyToId
        }).select(messageFields).single();
        if (result.error?.code === "23505" && input.messageId) {
            // This also handles two concurrent requests racing to insert the optimistic ID.
            // Never return another author's message or query outside the authorized destination.
            const existing = await supabase.from("messages").select(messageFields)
                .eq("id", input.messageId).eq("conversation_id", input.conversationId).eq("sender_id", userId).maybeSingle();
            if (existing.error) throw existing.error;
            if (!existing.data || existing.data.type !== "text" || existing.data.deleted_at !== null
                || existing.data.content !== content || existing.data.reply_to_id !== replyToId) {
                throw new MessageApiError(409, "Identifiant de message déjà utilisé.");
            }
            return NextResponse.json({ message: existing.data });
        }
        if (result.error?.code === "42501") throw new MessageApiError(403, "Envoi non autorisé.");
        if (result.error) throw result.error;
        if (!result.data) throw new Error("Missing inserted message");
        return NextResponse.json({ message: result.data }, { status: 201 });
    } catch (error) {
        return failure(error);
    }
}
