import Link from "next/link";

export default function SettingsPage() {
    return <main className="auth"><section className="auth-card"><div className="brand"><span className="brand-mark">✦</span>PULSE</div><h1>Paramètres</h1><p>Gère ton profil, ta langue, ton thème et tes préférences de notification.</p><div className="auth-form"><Link className="primary" href="/profile">Modifier mon profil</Link><Link className="auth-switch" href="/">Retour aux conversations</Link></div></section></main>;
}