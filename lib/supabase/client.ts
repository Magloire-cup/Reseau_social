import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider | null = null;
let browserClient: SupabaseClient | null = null;

// Clerk est désormais la seule source de jetons. Le client Supabase résout le
// jeton à chaque requête (REST, Storage, Realtime), on peut donc le créer une
// fois pour toutes, avant même que l'utilisateur soit connecté.
export function setSupabaseTokenProvider(provider: TokenProvider | null) {
    tokenProvider = provider;
}

export function createClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null;
    if (!browserClient) {
        browserClient = createSupabaseClient(url, key, {
            accessToken: async () => (tokenProvider ? await tokenProvider() : null),
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
    }
    return browserClient;
}
