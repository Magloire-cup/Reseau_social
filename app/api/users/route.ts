import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";

export async function GET(request: Request) {
    const supabase = await createServerSupabase();
    if (!supabase) return NextResponse.json({ users: [] });
    const auth = await supabase.auth.getUser();
    if (auth.error) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    const query = new URL(request.url).searchParams.get("q")?.trim() || "";
    if (query.length < 2) return NextResponse.json({ users: [] });
    const result = await supabase.from("users").select("id, name, username, avatar, status, online").or(`username.ilike.%${query}%,name.ilike.%${query}%`).limit(20);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ users: result.data });
}
