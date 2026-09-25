import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";

const allowedTypes = new Set(["text", "image", "file", "audio"]);

export async function GET(request: Request) {
    const supabase = await createServerSupabase();
    if (!supabase) return NextResponse.json({ messages: [] });
    const user = await supabase.auth.getUser();
    if (user.error) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    const conversationId = new URL(request.url).searchParams.get("conversationId");
    if (!conversationId) return NextResponse.json({ error: "conversationId est obligatoire." }, { status: 400 });
    const result = await supabase.from("messages").select("id, conversation_id, sender_id, content, type, status, created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(100);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ messages: result.data });
}

export async function POST(request: Request) {
    const supabase = await createServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Supabase n'est pas configuré." }, { status: 503 });
    const user = await supabase.auth.getUser();
    if (user.error || !user.data.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    const input = await request.json() as { conversationId?: string; content?: string; type?: string };
    const content = String(input.content || "").trim();
    const type = input.type || "text";
    if (!input.conversationId || !content || content.length > 4000 || !allowedTypes.has(type)) return NextResponse.json({ error: "Message invalide." }, { status: 400 });
    const result = await supabase.from("messages").insert({ conversation_id: input.conversationId, sender_id: user.data.user.id, content, type, status: "sent" }).select().single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ message: result.data }, { status: 201 });
}
