"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { askGemini, type GeminiMessage } from "../lib/gemini";
import { createClient } from "../lib/supabase/client";

type Language = "fr" | "en";
type ChatMessage = GeminiMessage & { id: string; createdAt: string };
type Conversation = { id: string; name: string; type: "ai" | "direct" | "group"; preview: string; online?: boolean };

const copy = {
    fr: { brand: "PULSE", private: "MESSAGERIE PRIVÉE", title: "Les conversations qui comptent.", subtitle: "Un espace vivant pour parler, créer et garder le fil.", login: "Se connecter", register: "Créer un compte", name: "Nom affiché", email: "Email", password: "Mot de passe", enter: "Entrer dans Pulse", create: "Créer mon espace", search: "Rechercher une conversation", messages: "Messages", all: "Tout", unread: "Non lus", newChat: "Nouvelle conversation", empty: "Choisis une conversation", emptyText: "Sélectionne un échange pour commencer.", assistant: "Assistant IA", online: "En ligne", write: "Écrire un message...", aiGreeting: "Bonjour. Je peux t'aider à rédiger, résumer ou organiser une idée.", supabaseMissing: "Supabase n'est pas configuré. Ajoute les variables dans .env.local puis redémarre Next.js.", logout: "Se déconnecter" },
    en: { brand: "PULSE", private: "PRIVATE MESSAGING", title: "Conversations that matter.", subtitle: "A living space to talk, create, and keep the thread.", login: "Log in", register: "Create account", name: "Display name", email: "Email", password: "Password", enter: "Enter Pulse", create: "Create my space", search: "Search a conversation", messages: "Messages", all: "All", unread: "Unread", newChat: "New conversation", empty: "Choose a conversation", emptyText: "Select a chat to get started.", assistant: "AI Assistant", online: "Online", write: "Write a message...", aiGreeting: "Hello. I can help you draft, summarize, or organize an idea.", supabaseMissing: "Supabase is not configured. Add the variables to .env.local and restart Next.js.", logout: "Log out" }
};

const aiConversation: Conversation = { id: "ai-gemini", name: "Gemini AI", type: "ai", preview: "Assistant IA", online: true };
const initialMessages = (language: Language): ChatMessage[] => [{ id: "welcome", role: "model", content: copy[language].aiGreeting, createdAt: new Date().toISOString() }];

export default function HomePage({ initialMode = "login" }: { initialMode?: "login" | "register" }) {
    const [language, setLanguage] = useState<Language>("fr");
    const [dark, setDark] = useState(false);
    const [authMode, setAuthMode] = useState<"login" | "register">(initialMode);
    const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
    const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
    const [authError, setAuthError] = useState("");
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState("ai-gemini");
    const [aiConversationId, setAiConversationId] = useState<string | null>(null);
    const [messageInput, setMessageInput] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages("fr"));
    const [isSending, setIsSending] = useState(false);
    const [showList, setShowList] = useState(true);
    const t = copy[language];
    const supabase = useMemo(() => createClient(), []);

    useEffect(() => {
        const savedLanguage = window.localStorage.getItem("pulse-language");
        if (savedLanguage === "en" || savedLanguage === "fr") setLanguage(savedLanguage);
        const savedTheme = window.localStorage.getItem("pulse-theme");
        setDark(savedTheme === "dark");
        supabase?.auth.getUser().then(({ data }) => setUser(data.user ? { id: data.user.id, email: data.user.email } : null));
    }, [supabase]);

    useEffect(() => {
        if (!supabase || !user) return;
        const client = supabase;
        const currentUser = user;
        let active = true;
        async function ensureAiConversation() {
            const existing = await client.from("conversation_members").select("conversation_id, conversations!inner(id, type)").eq("user_id", currentUser.id).eq("conversations.type", "ai").limit(1).maybeSingle();
            if (existing.data && active) {
                setAiConversationId(existing.data.conversation_id);
                return;
            }
            const created = await client.from("conversations").insert({ type: "ai", name: "Gemini AI" }).select("id").single();
            if (!created.error && created.data) {
                await client.from("conversation_members").insert({ conversation_id: created.data.id, user_id: currentUser.id });
                if (active) setAiConversationId(created.data.id);
            }
        }
        ensureAiConversation();
        return () => { active = false; };
    }, [supabase, user]);

    useEffect(() => {
        window.localStorage.setItem("pulse-language", language);
        if (selectedId === "ai-gemini" && messages.length === 1) setMessages(initialMessages(language));
    }, [language, selectedId, messages.length]);

    useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; window.localStorage.setItem("pulse-theme", dark ? "dark" : "light"); }, [dark]);

    const visibleConversations = useMemo(() => [aiConversation].filter(item => item.name.toLowerCase().includes(query.toLowerCase())), [query]);

    async function submitAuth(event: FormEvent) {
        event.preventDefault();
        setAuthError("");
        if (!supabase) { setAuthError(t.supabaseMissing); return; }
        const result = authMode === "login"
            ? await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password })
            : await supabase.auth.signUp({ email: authForm.email, password: authForm.password, options: { data: { name: authForm.name } } });
        if (result.error) setAuthError(result.error.message);
        else if (result.data.user) setUser({ id: result.data.user.id, email: result.data.user.email });
    }

    async function logout() { await supabase?.auth.signOut(); setUser(null); }

    async function sendMessage(event: FormEvent) {
        event.preventDefault();
        const prompt = messageInput.trim();
        if (!prompt || isSending) return;
        const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: prompt, createdAt: new Date().toISOString() };
        const nextMessages = [...messages, userMessage];
        setMessages(nextMessages);
        setMessageInput("");
        setIsSending(true);
        try {
            const answer = await askGemini(aiConversationId || selectedId, nextMessages.map(message => ({ role: message.role, content: message.content })), language);
            setMessages(current => [...current, { id: answer.id, role: "model", content: answer.content, createdAt: answer.createdAt }]);
        } catch (error) {
            setMessages(current => [...current, { id: crypto.randomUUID(), role: "model", content: error instanceof Error ? error.message : "Gemini est indisponible.", createdAt: new Date().toISOString() }]);
        } finally { setIsSending(false); }
    }

    if (!user) return <main className="auth"><section className="auth-card"><div className="brand"><span className="brand-mark">✦</span>{t.brand}</div><p className="eyebrow">{t.private}</p><h1>{t.title}</h1><p>{t.subtitle}</p><div className="top-actions"><button className="icon-button" onClick={() => setLanguage(language === "fr" ? "en" : "fr")}>{language.toUpperCase()}</button><button className="icon-button" onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</button></div><div className="auth-tabs"><button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>{t.login}</button><button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>{t.register}</button></div><form className="auth-form" onSubmit={submitAuth}>{authMode === "register" && <label>{t.name}<input required value={authForm.name} onChange={event => setAuthForm({ ...authForm, name: event.target.value })} /></label>}<label>{t.email}<input required type="email" value={authForm.email} onChange={event => setAuthForm({ ...authForm, email: event.target.value })} /></label><label>{t.password}<input required minLength={8} type="password" value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} /></label><button className="primary" type="submit">{authMode === "login" ? t.enter : t.create}</button>{authError && <span className="error">{authError}</span>}</form></section></main>;

    return <main className={`pulse-shell ${showList ? "show-list" : ""}`}><aside className="pulse-sidebar"><header className="pulse-topbar"><div className="brand"><span className="brand-mark">✦</span>{t.brand}</div><div className="top-actions"><button className="icon-button" onClick={() => setLanguage(language === "fr" ? "en" : "fr")}>{language.toUpperCase()}</button><button className="icon-button" onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</button></div></header><div className="search"><input aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} /></div><div className="sidebar-heading"><strong>{t.messages}</strong><button className="new-chat" aria-label={t.newChat}>＋</button></div><div className="conversation-list">{visibleConversations.map(conversation => <button key={conversation.id} className={`conversation ${selectedId === conversation.id ? "active" : ""}`} onClick={() => { setSelectedId(conversation.id); setShowList(false); }}><img className="avatar" src="/images/gemini-avatar.svg" alt="" /><span className="conversation-copy"><span className="conversation-line"><span className="conversation-name">{conversation.name}</span><span className="conversation-time">now</span></span><span className="conversation-preview">{conversation.preview}</span></span></button>)}</div><button className="profile-footer" onClick={logout}><img className="avatar" src="/images/default-avatar.svg" alt="" /><span>{user.email}</span><span>↪</span></button></aside><section className="chat-panel"><header className="chat-header"><button className="icon-button back-button" onClick={() => setShowList(true)}>←</button><img className="avatar" src="/images/gemini-avatar.svg" alt="Gemini AI" /><div className="chat-title"><h2>{aiConversation.name}</h2><p>{t.online} · {t.assistant}</p></div><button className="icon-button">•••</button></header><div className="message-list">{messages.map(message => <div key={message.id} className={`message-row ${message.role === "user" ? "outgoing" : ""}`}><div className="bubble">{message.content}<span className="message-meta">{new Date(message.createdAt).toLocaleTimeString(language === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" })}{message.role === "user" ? " ✓✓" : ""}</span></div></div>)}{isSending && <div className="message-row"><div className="bubble">{language === "fr" ? "Gemini écrit..." : "Gemini is typing..."}</div></div>}</div><form className="composer" onSubmit={sendMessage}><input value={messageInput} onChange={event => setMessageInput(event.target.value)} placeholder={t.write} disabled={isSending} /><button className="send" aria-label="Send" type="submit">➤</button></form></section></main>;
}
