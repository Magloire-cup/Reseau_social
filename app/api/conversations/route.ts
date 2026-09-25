import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";

export async function GET() {
    const supabase = await createServerSupabase();
    if (!supabase) return NextResponse.json({ conversations: [] });
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    const result = await supabase.from("conversation_members").select("conversation_id, conversations(id, type, name, created_at)").eq("user_id", auth.data.user.id);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ conversations: result.data.map(item => item.conversations).filter(Boolean) });
}

export async function POST(request: Request) {
    const supabase = await createServerSupabase();
    if (!supabase) return NextResponse.json({ error: "Supabase n'est pas configuré." }, { status: 503 });
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data.user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    const input = await request.json() as { userId?: string; name?: string };
    if (!input.userId || input.userId === auth.data.user.id) return NextResponse.json({ error: "Utilisateur invalide." }, { status: 400 });
    const created = await supabase.from("conversations").insert({ type: "direct", name: input.name || "Conversation" }).select().single();
    if (created.error) return NextResponse.json({ error: created.error.message }, { status: 500 });
    const members = await supabase.from("conversation_members").insert([{ conversation_id: created.data.id, user_id: auth.data.user.id }, { conversation_id: created.data.id, user_id: input.userId }]);
    if (members.error) return NextResponse.json({ error: members.error.message }, { status: 500 });
    return NextResponse.json({ conversation: created.data }, { status: 201 });
}
