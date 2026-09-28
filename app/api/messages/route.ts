import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";

const allowedTypes = new Set(["text", "image", "file", "audio"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
    const supabase = await createServerSupabase();
    if (!supabase) return NextResponse.json({ messages: [] });
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    const conversationId = new URL(request.url).searchParams.get("conversationId");
    if (!conversationId) return NextResponse.json({ error: "conversationId est obligatoire." }, { status: 400 });
    const result = await supabase.from("messages").select("id, conversation_id, sender_id, content, type, status, created_at, reply_to_id").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(100);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ messages: result.data });
}

export async function POST(request: Request) {
    const supabase = await createServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Supabase n'est pas configuré." }, { status: 503 });
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    const input = await request.json() as { conversationId?: string; content?: string; type?: string; messageId?: string; replyToId?: string };
    const content = String(input.content || "").trim();
    const type = input.type || "text";
    if (!input.conversationId || !content || content.length > 4000 || !allowedTypes.has(type)) return NextResponse.json({ error: "Message invalide." }, { status: 400 });
    const messageId = input.messageId && uuidPattern.test(input.messageId) ? input.messageId : null;
    let replyToId: string | null = null;
    if (input.replyToId) {
        if (!uuidPattern.test(input.replyToId)) return NextResponse.json({ error: "Message invalide." }, { status: 400 });
        const target = await supabase.from("messages").select("id").eq("id", input.replyToId).eq("conversation_id", input.conversationId).maybeSingle();
        if (!target.data) return NextResponse.json({ error: "Message cité introuvable." }, { status: 400 });
        replyToId = input.replyToId;
    }
    const result = await supabase.from("messages").insert({ id: messageId ?? undefined, conversation_id: input.conversationId, sender_id: userId, content, type, status: "sent", reply_to_id: replyToId }).select().single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ message: result.data }, { status: 201 });
}
