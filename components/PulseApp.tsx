"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askGemini, type GeminiMessage } from "../lib/gemini";
import { createClient } from "../lib/supabase/client";
import { ConversationList, type ConversationListItem } from "./sidebar/ConversationList";
import { MessageBubble } from "./chat/MessageBubble";
import { MessageInput } from "./chat/MessageInput";

type Language = "fr" | "en";
type ChatMessage = GeminiMessage & { id: string; createdAt: string; status?: "sent" | "delivered" | "read" };
type Profile = { id: string; name: string; username: string | null; avatar: string | null; online: boolean; status?: string };
type DbMessageRow = { id: string; conversation_id: string; sender_id: string | null; content: string; type: string; status: "sent" | "delivered" | "read"; created_at: string };
type ConvShape = {
    id: string; type: "ai" | "direct" | "group"; name: string; created_at: string;
    messages: { content: string; created_at: string }[] | null;
    conversation_members: { users: Profile | null }[] | null;
};

const copy = {
    fr: { brand: "PULSE", private: "MESSAGERIE PRIVÉE", title: "Les conversations qui comptent.", subtitle: "Un espace vivant pour parler, créer et garder le fil.", login: "Se connecter", register: "Créer un compte", name: "Nom affiché", email: "Email", password: "Mot de passe", enter: "Entrer dans Pulse", create: "Créer mon espace", search: "Rechercher une conversation", messages: "Messages", newChat: "Nouvelle conversation", assistant: "Assistant IA", online: "En ligne", offline: "Hors ligne", write: "Écrire un message...", aiGreeting: "Bonjour. Je peux t'aider à rédiger, résumer ou organiser une idée.", supabaseMissing: "Supabase n'est pas configuré. Ajoute les variables dans .env.local puis redémarre Next.js.", searchUser: "Rechercher un utilisateur (nom ou @pseudo)", noUserFound: "Aucun utilisateur trouvé.", close: "Fermer", sendFailed: "Envoi impossible. Réessaie.", typing: "Gemini écrit..." },
    en: { brand: "PULSE", private: "PRIVATE MESSAGING", title: "Conversations that matter.", subtitle: "A living space to talk, create, and keep the thread.", login: "Log in", register: "Create account", name: "Display name", email: "Email", password: "Password", enter: "Enter Pulse", create: "Create my space", search: "Search a conversation", messages: "Messages", newChat: "New conversation", assistant: "AI Assistant", online: "Online", offline: "Offline", write: "Write a message...", aiGreeting: "Hello. I can help you draft, summarize, or organize an idea.", supabaseMissing: "Supabase is not configured. Add the variables to .env.local and restart Next.js.", searchUser: "Search a user (name or @username)", noUserFound: "No user found.", close: "Close", sendFailed: "Could not send. Try again.", typing: "Gemini is typing..." }
};

const aiEntry = (language: Language): ConversationListItem => ({ id: "ai-gemini", name: "Gemini AI", preview: copy[language].assistant, online: true, avatar: "/images/gemini-avatar.svg" });
const initialMessages = (language: Language): ChatMessage[] => [{ id: "welcome", role: "model", content: copy[language].aiGreeting, createdAt: new Date().toISOString() }];

export default function PulseApp({ initialMode = "login" }: { initialMode?: "login" | "register" }) {
    const [language, setLanguage] = useState<Language>("fr");
    const [dark, setDark] = useState(false);
    const [authMode, setAuthMode] = useState<"login" | "register">(initialMode);
    const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
    const [authError, setAuthError] = useState("");
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState("ai-gemini");
    const [aiConversationId, setAiConversationId] = useState<string | null>(null);
    const [conversations, setConversations] = useState<ConversationListItem[]>([]);
    const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages("fr"));
    const [isSending, setIsSending] = useState(false);
    const [showList, setShowList] = useState(true);
    const [newChatOpen, setNewChatOpen] = useState(false);
    const [userQuery, setUserQuery] = useState("");
    const [userResults, setUserResults] = useState<Profile[]>([]);
    const [usersLoading, setUsersLoading] = useState(false);
    const [startBusy, setStartBusy] = useState(false);
    const t = copy[language];
    const supabase = useMemo(() => createClient(), []);

    const selectedRef = useRef(selectedId);
    selectedRef.current = selectedId;
    const aiConvRef = useRef<string | null>(null);
    aiConvRef.current = aiConversationId;
    const reloadMessagesRef = useRef<() => void>(() => {});

    const activeConvId = selectedId === "ai-gemini" ? aiConversationId : selectedId;

    useEffect(() => {
        const savedLanguage = window.localStorage.getItem("pulse-language");
        if (savedLanguage === "en" || savedLanguage === "fr") setLanguage(savedLanguage);
        setDark(window.localStorage.getItem("pulse-theme") === "dark");
        if (!supabase) return;
        supabase.auth.getUser().then(({ data }) => setUser(data.user ? { id: data.user.id, email: data.user.email } : null));
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ? { id: session.user.id, email: session.user.email } : null));
        return () => sub.subscription.unsubscribe();
    }, [supabase]);

    useEffect(() => {
        window.localStorage.setItem("pulse-language", language);
        if (selectedId === "ai-gemini" && messages.length <= 1) setMessages(initialMessages(language));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language]);

    useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; window.localStorage.setItem("pulse-theme", dark ? "dark" : "light"); }, [dark]);

    // Profil + présence
    useEffect(() => {
        if (!supabase || !user) return;
        let active = true;
        (async () => {
            await supabase.from("users").upsert({ id: user.id, name: user.email?.split("@")[0] ?? "" }, { onConflict: "id", ignoreDuplicates: true });
            await supabase.from("users").update({ online: true }).eq("id", user.id);
            const { data } = await supabase.from("users").select("id, name, username, avatar, online, status").eq("id", user.id).maybeSingle();
            if (active && data) setProfile(data);
        })();
        const goOffline = () => { supabase.from("users").update({ online: false }).eq("id", user.id); };
        window.addEventListener("pagehide", goOffline);
        return () => { active = false; window.removeEventListener("pagehide", goOffline); goOffline(); };
    }, [supabase, user]);

    // Conversation IA dédiée par utilisateur
    const aiInitRef = useRef<string | null>(null);
    useEffect(() => {
        if (!supabase || !user || aiInitRef.current === user.id) return;
        aiInitRef.current = user.id;
        (async () => {
            const existing = await supabase.from("conversation_members").select("conversation_id, conversations!inner(id, type)").eq("user_id", user.id).eq("conversations.type", "ai").limit(1).maybeSingle();
            if (existing.data) {
                setAiConversationId(existing.data.conversation_id);
                return;
            }
            // Id généré côté client : INSERT ... RETURNING échouerait, la politique SELECT
            // exige d'être membre alors que l'adhésion n'est créée qu'après.
            const id = crypto.randomUUID();
            const created = await supabase.from("conversations").insert({ id, type: "ai", name: "Gemini AI" });
            if (created.error) return;
            const member = await supabase.from("conversation_members").insert({ conversation_id: id, user_id: user.id });
            if (!member.error) setAiConversationId(id);
        })();
    }, [supabase, user]);

    const loadConversations = useCallback(async () => {
        if (!supabase || !user) return;
        const { data } = await supabase.from("conversation_members")
            .select("conversation_id, conversations(id, type, name, created_at, messages(id, content, created_at, sender_id), conversation_members(user_id, users(id, name, username, avatar, online)))")
            .eq("user_id", user.id);
        const rows = (data ?? []) as unknown as { conversations: ConvShape | null }[];
        const items: ConversationListItem[] = rows
            .map(row => row.conversations)
            .filter((conv): conv is ConvShape => conv !== null && conv.type !== "ai")
            .map(conv => {
                const other = (conv.conversation_members ?? []).map(member => member.users).find(u => u && u.id !== user.id);
                const last = (conv.messages ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
                return {
                    id: conv.id,
                    name: conv.type === "direct" && other ? (other.name || other.username || "Membre") : conv.name,
                    preview: last ? last.content : "",
                    online: conv.type === "direct" ? other?.online : undefined,
                    avatar: conv.type === "direct" && other?.avatar ? other.avatar : undefined
                };
            });
        setConversations(items);
    }, [supabase, user]);

    useEffect(() => { loadConversations(); }, [loadConversations]);

    const loadMessages = useCallback(async (conversationId: string) => {
        if (!supabase || !user) return;
        const { data } = await supabase.from("messages")
            .select("id, conversation_id, sender_id, content, type, status, created_at")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true })
            .limit(200);
        const rows: DbMessageRow[] = data ?? [];
        setMessages(rows.length === 0 && selectedRef.current === "ai-gemini"
            ? initialMessages(language)
            : rows.map(row => ({ id: row.id, role: row.sender_id === user.id ? "user" as const : "model" as const, content: row.content, createdAt: row.created_at, status: row.status })));
    }, [supabase, user, language]);

    useEffect(() => {
        if (!activeConvId) return;
        loadMessages(activeConvId);
    }, [activeConvId, loadMessages]);

    reloadMessagesRef.current = () => { if (activeConvId) loadMessages(activeConvId); };

    // Realtime : nouveaux messages, nouvelles conversations, présence
    useEffect(() => {
        if (!supabase || !user) return;
        const channel = supabase.channel("pulse-realtime")
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => {
                const active = selectedRef.current === "ai-gemini" ? aiConvRef.current : selectedRef.current;
                if (active && (payload.new as { conversation_id: string }).conversation_id === active) reloadMessagesRef.current();
                loadConversations();
            })
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_members", filter: `user_id=eq.${user.id}` }, () => loadConversations())
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "users" }, () => loadConversations())
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [supabase, user, loadConversations]);

    const visibleConversations = useMemo(
        () => [aiEntry(language), ...conversations].filter(item => item.name.toLowerCase().includes(query.toLowerCase())),
        [conversations, query, language]
    );
    const selectedConversation = visibleConversations.find(item => item.id === selectedId) ?? aiEntry(language);

    async function submitAuth(event: FormEvent) {
        event.preventDefault();
        setAuthError("");
        if (!supabase) { setAuthError(t.supabaseMissing); return; }
        const result = authMode === "login"
            ? await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password })
            : await supabase.auth.signUp({ email: authForm.email, password: authForm.password, options: { data: { name: authForm.name } } });
        if (result.error) setAuthError(result.error.message);
        else if (result.data.session && result.data.user) setUser({ id: result.data.user.id, email: result.data.user.email });
        else setAuthError(language === "fr" ? "Compte créé. Confirme ton email reçu par courrier, puis connecte-toi." : "Account created. Confirm the email you received, then log in.");
    }

    async function logout() {
        if (supabase && user) await supabase.from("users").update({ online: false }).eq("id", user.id);
        await supabase?.auth.signOut();
        setUser(null);
        setProfile(null);
        setConversations([]);
        setSelectedId("ai-gemini");
        setMessages(initialMessages(language));
    }

    async function sendMessage(content: string) {
        const prompt = content.trim();
        if (!prompt || isSending) return;
        setIsSending(true);
        if (selectedId === "ai-gemini") {
            const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: prompt, createdAt: new Date().toISOString() };
            const nextMessages = [...messages, userMessage];
            setMessages(nextMessages);
            try {
                const answer = await askGemini(aiConversationId || selectedId, nextMessages.map(message => ({ role: message.role, content: message.content })), language);
                setMessages(current => [...current, { id: answer.id, role: "model", content: answer.content, createdAt: answer.createdAt }]);
            } catch (error) {
                setMessages(current => [...current, { id: crypto.randomUUID(), role: "model", content: error instanceof Error ? error.message : t.sendFailed, createdAt: new Date().toISOString() }]);
            } finally { setIsSending(false); }
            return;
        }
        const optimistic: ChatMessage = { id: crypto.randomUUID(), role: "user", content: prompt, createdAt: new Date().toISOString(), status: "sent" };
        setMessages(current => [...current, optimistic]);
        try {
            const response = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: selectedId, content: prompt, type: "text" }) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || t.sendFailed);
            setMessages(current => [...current.filter(message => message.id !== optimistic.id), { id: payload.message.id, role: "user", content: payload.message.content, createdAt: payload.message.created_at, status: payload.message.status }]);
        } catch {
            setMessages(current => [...current.filter(message => message.id !== optimistic.id), { id: crypto.randomUUID(), role: "model", content: t.sendFailed, createdAt: new Date().toISOString() }]);
        } finally { setIsSending(false); loadConversations(); }
    }

    useEffect(() => {
        if (!newChatOpen) return;
        const q = userQuery.trim();
        if (q.length < 2) { setUserResults([]); return; }
        const timer = setTimeout(async () => {
            setUsersLoading(true);
            try {
                const response = await fetch(`/api/users?q=${encodeURIComponent(q)}`);
                const payload = await response.json();
                setUserResults((payload.users ?? []).filter((found: Profile) => found.id !== user?.id));
            } finally { setUsersLoading(false); }
        }, 250);
        return () => clearTimeout(timer);
    }, [newChatOpen, userQuery, user]);

    async function startConversation(target: Profile) {
        if (!supabase || !user || startBusy) return;
        setStartBusy(true);
        try {
            const { data: mine } = await supabase.from("conversations").select("id, conversation_members(user_id)").eq("type", "direct");
            const existing = (mine ?? []).find((conv: { conversation_members: { user_id: string }[] }) => (conv.conversation_members ?? []).some(member => member.user_id === target.id));
            let conversationId: string | undefined = existing?.id;
            if (!conversationId) {
                const response = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: target.id, name: target.name }) });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || t.sendFailed);
                conversationId = payload.conversation.id;
            }
            setNewChatOpen(false); setUserQuery(""); setUserResults([]);
            await loadConversations();
            if (conversationId) { setSelectedId(conversationId); setShowList(false); }
        } finally { setStartBusy(false); }
    }

    if (!user) return <main className="auth"><section className="auth-card"><div className="brand"><span className="brand-mark">✦</span>{t.brand}</div><p className="eyebrow">{t.private}</p><h1>{t.title}</h1><p>{t.subtitle}</p><div className="top-actions"><button className="icon-button" onClick={() => setLanguage(language === "fr" ? "en" : "fr")}>{language.toUpperCase()}</button><button className="icon-button" onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</button></div><div className="auth-tabs"><button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>{t.login}</button><button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>{t.register}</button></div><form className="auth-form" onSubmit={submitAuth}>{authMode === "register" && <label>{t.name}<input required value={authForm.name} onChange={event => setAuthForm({ ...authForm, name: event.target.value })} /></label>}<label>{t.email}<input required type="email" value={authForm.email} onChange={event => setAuthForm({ ...authForm, email: event.target.value })} /></label><label>{t.password}<input required minLength={8} type="password" value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} /></label><button className="primary" type="submit">{authMode === "login" ? t.enter : t.create}</button>{authError && <span className="error">{authError}</span>}</form></section></main>;

    return <main className={`pulse-shell ${showList ? "show-list" : ""}`}>
        <aside className="pulse-sidebar">
            <header className="pulse-topbar"><div className="brand"><span className="brand-mark">✦</span>{t.brand}</div><div className="top-actions"><button className="icon-button" onClick={() => setLanguage(language === "fr" ? "en" : "fr")}>{language.toUpperCase()}</button><button className="icon-button" onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</button></div></header>
            <div className="search"><input aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} /></div>
            <div className="sidebar-heading"><strong>{t.messages}</strong><button className="new-chat" aria-label={t.newChat} type="button" onClick={() => setNewChatOpen(true)}>＋</button></div>
            <ConversationList items={visibleConversations} selectedId={selectedId} onSelect={id => { setSelectedId(id); setShowList(false); }} />
            <button className="profile-footer" type="button" onClick={logout}><img className="avatar" src={profile?.avatar || "/images/default-avatar.svg"} alt="" /><span>{profile?.name || user.email}</span><span>↪</span></button>
        </aside>
        <section className="chat-panel">
            <header className="chat-header">
                <button className="icon-button back-button" type="button" onClick={() => setShowList(true)}>←</button>
                <img className="avatar" src={selectedConversation.avatar || (selectedConversation.id === "ai-gemini" ? "/images/gemini-avatar.svg" : "/images/default-avatar.svg")} alt="" />
                <div className="chat-title"><h2>{selectedConversation.name}</h2><p>{selectedConversation.id === "ai-gemini" ? `${t.online} · ${t.assistant}` : selectedConversation.online ? t.online : t.offline}</p></div>
                <button className="icon-button" type="button">•••</button>
            </header>
            <div className="message-list">
                {messages.map(message => <MessageBubble key={message.id} content={message.content} outgoing={message.role === "user"} createdAt={message.createdAt} status={message.status} />)}
                {isSending && selectedId === "ai-gemini" && <div className="message-row"><div className="bubble">{t.typing}</div></div>}
            </div>
            <MessageInput placeholder={t.write} disabled={isSending} onSend={sendMessage} />
        </section>
        {newChatOpen && <div className="modal-overlay" onClick={() => setNewChatOpen(false)}>
            <div className="modal" onClick={event => event.stopPropagation()}>
                <h3>{t.newChat}</h3>
                <input autoFocus className="modal-input" placeholder={t.searchUser} value={userQuery} onChange={event => setUserQuery(event.target.value)} />
                <div className="user-results">
                    {userResults.map(found => <button key={found.id} className="user-result" type="button" disabled={startBusy} onClick={() => startConversation(found)}><img className="avatar" src={found.avatar || "/images/default-avatar.svg"} alt="" /><span className="user-result-copy"><strong>{found.name || found.username}</strong>{found.username && <small> @{found.username}</small>}{found.online && <em className="online-label"> · {t.online}</em>}</span></button>)}
                    {userQuery.trim().length >= 2 && !usersLoading && userResults.length === 0 && <p className="modal-empty">{t.noUserFound}</p>}
                </div>
                <button className="modal-close" type="button" onClick={() => setNewChatOpen(false)}>{t.close}</button>
            </div>
        </div>}
    </main>;
}
