"use client";

import { FormEvent, useState } from "react";
import { createClient } from "../../lib/supabase/client";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const supabase = createClient();

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!supabase) return setMessage("Supabase n'est pas configuré.");
        const result = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/profile` });
        setMessage(result.error?.message || "Un email de réinitialisation a été envoyé.");
    }

    return <main className="auth"><section className="auth-card"><div className="brand"><span className="brand-mark">✦</span>PULSE</div><h1>Mot de passe oublié</h1><p>Entre ton email pour recevoir un lien sécurisé.</p><form className="auth-form" onSubmit={submit}><label>Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} /></label><button className="primary" type="submit">Envoyer le lien</button></form><p>{message}</p></section></main>;
}