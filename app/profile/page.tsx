"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/client";

export default function ProfilePage() {
    const supabase = useMemo(() => createClient(), []);
    const [name, setName] = useState("");
    const [username, setUsername] = useState("");
    const [bio, setBio] = useState("");
    const [message, setMessage] = useState("");

    useEffect(() => { supabase?.auth.getUser().then(async ({ data }) => { if (!data.user) return; const profile = await supabase.from("users").select("name, username, status").eq("id", data.user.id).single(); if (profile.data) { setName(profile.data.name || ""); setUsername(profile.data.username || ""); setBio(profile.data.status || ""); } }); }, [supabase]);

    async function save(event: FormEvent) { event.preventDefault(); const auth = await supabase?.auth.getUser(); if (!supabase || !auth?.data.user) return setMessage("Connecte-toi pour modifier ton profil."); const result = await supabase.from("users").update({ name, username, status: bio }).eq("id", auth.data.user.id); setMessage(result.error?.message || "Profil enregistré."); }

    return <main className="auth"><section className="auth-card"><div className="brand"><span className="brand-mark">✦</span>PULSE</div><h1>Mon profil</h1><form className="auth-form" onSubmit={save}><label>Nom<input value={name} onChange={event => setName(event.target.value)} required /></label><label>Username<input value={username} onChange={event => setUsername(event.target.value)} required /></label><label>Bio<textarea value={bio} onChange={event => setBio(event.target.value)} rows={4} /></label><button className="primary" type="submit">Enregistrer</button></form><p>{message}</p></section></main>;
}