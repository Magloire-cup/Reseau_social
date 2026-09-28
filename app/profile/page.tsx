"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient, setSupabaseTokenProvider } from "../../lib/supabase/client";

export default function ProfilePage() {
    const supabase = useMemo(() => createClient(), []);
    const { isLoaded, getToken } = useAuth();
    const { user } = useUser();
    const [name, setName] = useState("");
    const [username, setUsername] = useState("");
    const [bio, setBio] = useState("");
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (!supabase) return;
        setSupabaseTokenProvider(() => getToken({ template: "supabase" }));
        return () => setSupabaseTokenProvider(null);
    }, [supabase, getToken]);

    useEffect(() => {
        if (!supabase || !user) return;
        void supabase.from("users").select("name, username, status").eq("id", user.id).maybeSingle().then(({ data }) => {
            if (!data) return;
            setName(data.name || "");
            setUsername(data.username || "");
            setBio(data.status || "");
        });
    }, [supabase, user]);

    async function save(event: FormEvent) {
        event.preventDefault();
        if (!supabase || !user) { setMessage("Connecte-toi pour modifier ton profil."); return; }
        const result = await supabase.from("users").update({ name, username, status: bio }).eq("id", user.id);
        setMessage(result.error?.message || "Profil enregistré.");
    }

    if (!isLoaded) return <main className="auth"><section className="auth-card"><div className="brand"><span className="brand-mark">✦</span>Pulse Messenger</div><p>Chargement…</p></section></main>;

    if (!user) return <main className="auth"><section className="auth-card"><div className="brand"><span className="brand-mark">✦</span>Pulse Messenger</div><h1>Mon profil</h1><p>Connecte-toi pour modifier ton profil.</p><p><a href="/login">Se connecter</a></p></section></main>;

    return <main className="auth"><section className="auth-card"><div className="brand"><span className="brand-mark">✦</span>Pulse Messenger</div><h1>Mon profil</h1><form className="auth-form" onSubmit={save}><label>Nom<input value={name} onChange={event => setName(event.target.value)} required /></label><label>Username<input value={username} onChange={event => setUsername(event.target.value)} required /></label><label>Bio<textarea value={bio} onChange={event => setBio(event.target.value)} rows={4} /></label><button className="primary" type="submit">Enregistrer</button></form><p>{message}</p></section></main>;
}
