import { auth } from "@clerk/nextjs/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export async function createServerSupabase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;
    const { getToken } = await auth();
    return createSupabaseClient(url, key, {
        accessToken: async () => (await getToken({ template: "supabase" })) ?? null,
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
}
