"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { askGemini, type GeminiMessage } from "../lib/gemini";
import { createClient } from "../lib/supabase/client";
import { ConversationList, type ConversationListItem } from "./sidebar/ConversationList";
import { MessageBubble } from "./chat/MessageBubble";
import { MessageInput } from "./chat/MessageInput";
import { ProfileModal } from "./profile/ProfileModal";

type Language = "fr" | "en";
type ChatMessage = GeminiMessage & { id: string; createdAt: string; status?: "sent" | "delivered" | "read"; type?: string; audioUrl?: string | null; audioPath?: string | null; durationSeconds?: number | null };
type Profile = { id: string; name: string; username: string | null; avatar: string | null; online: boolean; status?: string };
type DbAttachment = { url: string; mime_type: string; duration_seconds: number | null };
type DbMessageRow = { id: string; conversation_id: string; sender_id: string | null; content: string; type: string; status: "sent" | "delivered" | "read"; created_at: string; attachments?: DbAttachment[] | null };
type ConvShape = {
    id: string; type: "ai" | "direct" | "group"; name: string; created_at: string;
    messages: { content: string; created_at: string; type: string }[] | null;
    conversation_members: { users: Profile | null }[] | null;
};

const copy = {
    fr: { brand: "PULSE", private: "MESSAGERIE PRIVÉE", title: "Les conversations qui comptent.", subtitle: "Un espace vivant pour parler, créer et garder le fil.", login: "Se connecter", register: "Créer un compte", name: "Nom affiché", email: "Email", password: "Mot de passe", enter: "Entrer dans Pulse", create: "Créer mon espace", search: "Rechercher une conversation", messages: "Messages", newChat: "Nouvelle conversation", assistant: "Assistant IA", online: "En ligne", offline: "Hors ligne", write: "Écrire un message...", aiGreeting: "Bonjour. Je peux t'aider à rédiger, résumer ou organiser une idée.", supabaseMissing: "Supabase n'est pas configuré. Ajoute les variables dans .env.local puis redémarre Next.js.", searchUser: "Rechercher un utilisateur (nom ou @pseudo)", noUserFound: "Aucun utilisateur trouvé.", close: "Fermer", sendFailed: "Envoi impossible. Réessaie.", typing: "Gemini écrit...", block: "Bloquer le contact", unblock: "Débloquer le contact", blockedByYou: "Vous avez bloqué ce contact. Aucun message ne peut être envoyé.", blockedNotice: "Cette conversation est bloquée. Aucun message ne peut être envoyé.", record: "Enregistrer un message vocal", stop: "Envoyer le vocal", cancel: "Annuler l'enregistrement", micUnavailable: "L'enregistrement vocal n'est pas disponible sur cet appareil.", voiceFailed: "Envoi du vocal impossible. Réessaie.", voiceUnavailable: "Vocal indisponible", voicePreview: "Message vocal", profile: "Mon profil", changePhoto: "Changer la photo", uploading: "Envoi en cours...", photoBadType: "Choisis une image PNG, JPEG ou WebP.", photoFailed: "Impossible de mettre à jour la photo.", logout: "Se déconnecter", loadingOlder: "Chargement des messages…", historyStart: "Début de la conversation" },
    en: { brand: "PULSE", private: "PRIVATE MESSAGING", title: "Conversations that matter.", subtitle: "A living space to talk, create, and keep the thread.", login: "Log in", register: "Create account", name: "Display name", email: "Email", password: "Password", enter: "Enter Pulse", create: "Create my space", search: "Search a conversation", messages: "Messages", newChat: "New conversation", assistant: "AI Assistant", online: "Online", offline: "Offline", write: "Write a message...", aiGreeting: "Hello. I can help you draft, summarize, or organize an idea.", supabaseMissing: "Supabase is not configured. Add the variables to .env.local and restart Next.js.", searchUser: "Search a user (name or @username)", noUserFound: "No user found.", close: "Close", sendFailed: "Could not send. Try again.", typing: "Gemini is typing...", block: "Block this contact", unblock: "Unblock this contact", blockedByYou: "You blocked this contact. No message can be sent.", blockedNotice: "This conversation is blocked. No message can be sent.", record: "Record a voice message", stop: "Send the voice message", cancel: "Cancel the recording", micUnavailable: "Voice recording is not available on this device.", voiceFailed: "Could not send the voice message. Try again.", voiceUnavailable: "Voice message unavailable", voicePreview: "Voice message", profile: "My profile", changePhoto: "Change photo", uploading: "Uploading...", photoBadType: "Choose a PNG, JPEG or WebP image.", photoFailed: "Could not update the photo.", logout: "Log out", loadingOlder: "Loading messages…", historyStart: "Start of the conversation" }
};

const aiEntry = (language: Language): ConversationListItem => ({ id: "ai-gemini", name: "Gemini AI", preview: copy[language].assistant, online: true, avatar: "/images/gemini-avatar.svg" });
const initialMessages = (language: Language): ChatMessage[] => [{ id: "welcome", role: "model", content: copy[language].aiGreeting, createdAt: new Date().toISOString() }];

const PAGE_SIZE = 50;
const STICK_THRESHOLD = 80;
const LOAD_OLDER_THRESHOLD = 150;

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
    const byId = new Map<string, ChatMessage>();
    for (const message of current) byId.set(message.id, message);
    for (const message of incoming) {
        const existing = byId.get(message.id);
        byId.set(message.id, existing
            ? { ...existing, ...message, audioUrl: message.audioUrl ?? existing.audioUrl, audioPath: message.audioPath ?? existing.audioPath, durationSeconds: message.durationSeconds ?? existing.durationSeconds }
            : message);
    }
    return [...byId.values()].sort((a, b) => a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt));
}

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
    const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
    const [convBlocked, setConvBlocked] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [profileOpen, setProfileOpen] = useState(false);
    const [hasOlder, setHasOlder] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [hasHistory, setHasHistory] = useState(false);
    const t = copy[language];
    const supabase = useMemo(() => createClient(), []);

    const selectedRef = useRef(selectedId);
    selectedRef.current = selectedId;
    const aiConvRef = useRef<string | null>(null);
    aiConvRef.current = aiConversationId;
    const reloadMessagesRef = useRef<() => void>(() => {});

    const activeConvId = selectedId === "ai-gemini" ? aiConversationId : selectedId;
    const activeConvRef = useRef<string | null>(null);
    activeConvRef.current = activeConvId;
    const listRef = useRef<HTMLDivElement | null>(null);
    const stickRef = useRef(true);
    const restoreRef = useRef<{ height: number; top: number } | null>(null);
    const loadTokenRef = useRef(0);
    const olderCursorRef = useRef<string | null>(null);
    const hasOlderRef = useRef(false);
    const loadingOlderRef = useRef(false);
    const languageRef = useRef(language);
    languageRef.current = language;

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
            .select("conversation_id, conversations(id, type, name, created_at, messages(id, content, created_at, type), conversation_members(user_id, users(id, name, username, avatar, online)))")
            .eq("user_id", user.id)
            .order("created_at", { referencedTable: "conversations.messages", ascending: false })
            .limit(1, { referencedTable: "conversations.messages" });
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
                    preview: last ? (last.type === "audio" ? copy[language].voicePreview : last.content) : "",
                    online: conv.type === "direct" ? other?.online : undefined,
                    avatar: conv.type === "direct" && other?.avatar ? other.avatar : undefined,
                    otherUserId: conv.type === "direct" && other ? other.id : undefined
                };
            });
        setConversations(items);
    }, [supabase, user, language]);

    useEffect(() => { loadConversations(); }, [loadConversations]);

    // Blocages émis par l'utilisateur courant
    const loadBlocks = useCallback(async () => {
        if (!supabase || !user) return;
        const { data } = await supabase.from("blocks").select("blocked_id").eq("blocker_id", user.id);
        setBlockedIds(new Set((data ?? []).map(row => row.blocked_id as string)));
    }, [supabase, user]);

    useEffect(() => { loadBlocks(); }, [loadBlocks]);

    // Conversation directe bloquée (dans un sens ou dans l'autre)
    useEffect(() => {
        if (!supabase || !user || selectedId === "ai-gemini" || !activeConvId) { setConvBlocked(false); return; }
        let active = true;
        (async () => {
            const { data } = await supabase.rpc("conversation_is_blocked", { conv_id: activeConvId });
            if (active) setConvBlocked(data === true);
        })();
        return () => { active = false; };
    }, [supabase, user, activeConvId, selectedId, blockedIds]);

    const toMessages = useCallback(async (rows: DbMessageRow[]): Promise<ChatMessage[]> => {
        if (!supabase || !user) return [];
        const audioPaths = rows.flatMap(row => (row.attachments ?? []).filter(attachment => Boolean(attachment.url)).map(attachment => attachment.url));
        const signedUrls = new Map<string, string>();
        if (audioPaths.length > 0) {
            const { data: urls } = await supabase.storage.from("voice-notes").createSignedUrls(audioPaths, 86400);
            (urls ?? []).forEach(entry => { if (entry.path && entry.signedUrl) signedUrls.set(entry.path, entry.signedUrl); });
        }
        return rows.map(row => {
            const attachment = row.attachments?.[0] ?? null;
            return {
                id: row.id,
                role: row.sender_id === user.id ? "user" as const : "model" as const,
                content: row.content,
                createdAt: row.created_at,
                status: row.status,
                type: row.type,
                audioUrl: row.type === "audio" && attachment ? signedUrls.get(attachment.url) ?? null : null,
                audioPath: row.type === "audio" && attachment ? attachment.url : null,
                durationSeconds: attachment?.duration_seconds ?? null
            };
        });
    }, [supabase, user]);

    const resignAudioUrl = useCallback(async (path: string) => {
        if (!supabase) return null;
        const { data } = await supabase.storage.from("voice-notes").createSignedUrl(path, 86400);
        return data?.signedUrl ?? null;
    }, [supabase]);

    // Libère l'espace : supprime les vocaux du bucket restés sans message (envoi interrompu).
    // Au plus une fois par jour et par navigateur, et seulement dans les conversations de l'utilisateur.
    const cleanupOrphanVoiceNotes = useCallback(async (conversationIds: string[]) => {
        if (!supabase || conversationIds.length === 0) return;
        const key = "pulse-voice-cleanup";
        const last = Number(window.localStorage.getItem(key) ?? "0");
        if (Number.isFinite(last) && last > 0 && Date.now() - last < 24 * 60 * 60 * 1000) return;
        window.localStorage.setItem(key, String(Date.now()));
        for (const conversationId of conversationIds.slice(0, 20)) {
            const { data: files } = await supabase.storage.from("voice-notes").list(conversationId, { limit: 100 });
            if (!files?.length) continue;
            const names = files.map(file => `${conversationId}/${file.name}`);
            const { data: refs } = await supabase.from("attachments").select("url").in("url", names);
            const referenced = new Set((refs ?? []).map(row => row.url as string));
            const orphans = files.filter(file => {
                if (referenced.has(`${conversationId}/${file.name}`)) return false;
                const created = file.created_at ? new Date(file.created_at).getTime() : Date.now();
                return Date.now() - created > 60 * 60 * 1000;
            }).map(file => `${conversationId}/${file.name}`);
            if (orphans.length > 0) await supabase.storage.from("voice-notes").remove(orphans);
        }
    }, [supabase]);

    useEffect(() => { void cleanupOrphanVoiceNotes(conversations.map(item => item.id)); }, [cleanupOrphanVoiceNotes, conversations]);

    // Une page = les PAGE_SIZE messages les plus récents avant `cursor` (rendus en ordre croissant) ;
    // on demande un message de plus pour savoir s'il reste de l'historique.
    const fetchPage = useCallback(async (conversationId: string, cursor?: string) => {
        if (!supabase) return { messages: [] as ChatMessage[], hasMore: false };
        let query = supabase.from("messages")
            .select("id, conversation_id, sender_id, content, type, status, created_at, attachments(url, mime_type, duration_seconds)")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(PAGE_SIZE + 1);
        if (cursor) query = query.lt("created_at", cursor);
        const { data } = await query;
        const rows = (data ?? []) as unknown as DbMessageRow[];
        return { messages: await toMessages(rows.slice(0, PAGE_SIZE).reverse()), hasMore: rows.length > PAGE_SIZE };
    }, [supabase, toMessages]);

    // Chargement initial : page la plus récente, vue collée en bas.
    useEffect(() => {
        if (!activeConvId) return;
        const token = ++loadTokenRef.current;
        olderCursorRef.current = null;
        hasOlderRef.current = false;
        loadingOlderRef.current = false;
        restoreRef.current = null;
        stickRef.current = true;
        setHasOlder(false);
        setLoadingOlder(false);
        setHasHistory(false);
        setMessages([]);
        (async () => {
            const page = await fetchPage(activeConvId);
            if (loadTokenRef.current !== token) return;
            if (page.messages.length === 0 && selectedRef.current === "ai-gemini") { setMessages(initialMessages(languageRef.current)); return; }
            if (page.messages.length > 0) {
                olderCursorRef.current = page.messages[0].createdAt;
                hasOlderRef.current = page.hasMore;
                setHasOlder(page.hasMore);
                setHasHistory(true);
            }
            setMessages(page.messages);
        })();
    }, [activeConvId, fetchPage]);

    // Nouveaux messages : on refusionne la page la plus récente (dédoublonnée par id),
    // ce qui garde aussi les pages plus anciennes déjà chargées.
    const refreshNewest = useCallback(async () => {
        const conversationId = activeConvRef.current;
        if (!conversationId) return;
        const token = loadTokenRef.current;
        const page = await fetchPage(conversationId);
        if (loadTokenRef.current !== token) return;
        setMessages(current => mergeMessages(current, page.messages));
    }, [fetchPage]);

    const loadOlder = useCallback(async () => {
        const conversationId = activeConvRef.current;
        const cursor = olderCursorRef.current;
        if (!conversationId || !cursor || loadingOlderRef.current || !hasOlderRef.current) return;
        loadingOlderRef.current = true;
        setLoadingOlder(true);
        const token = loadTokenRef.current;
        try {
            const page = await fetchPage(conversationId, cursor);
            if (loadTokenRef.current !== token) return;
            if (page.messages.length > 0) {
                olderCursorRef.current = page.messages[0].createdAt;
                const list = listRef.current;
                restoreRef.current = list ? { height: list.scrollHeight, top: list.scrollTop } : null;
                setMessages(current => mergeMessages(current, page.messages));
            }
            hasOlderRef.current = page.hasMore;
            setHasOlder(page.hasMore);
        } finally {
            if (loadTokenRef.current === token) { loadingOlderRef.current = false; setLoadingOlder(false); }
        }
    }, [fetchPage]);

    reloadMessagesRef.current = refreshNewest;

    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const restore = restoreRef.current;
        if (restore) {
            restoreRef.current = null;
            list.scrollTop = list.scrollHeight - restore.height + restore.top;
            return;
        }
        if (stickRef.current) list.scrollTop = list.scrollHeight;
    }, [messages, isSending, activeConvId]);

    function handleListScroll() {
        const list = listRef.current;
        if (!list) return;
        stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_THRESHOLD;
        if (list.scrollTop < LOAD_OLDER_THRESHOLD) loadOlder();
    }

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
        setProfileOpen(false);
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
            const nextMessages = mergeMessages(messages, [userMessage]);
            setMessages(nextMessages);
            try {
                const answer = await askGemini(aiConversationId || selectedId, nextMessages.map(message => ({ role: message.role, content: message.content })), language, userMessage.id);
                setMessages(current => mergeMessages(current, [{ id: answer.id, role: "model", content: answer.content, createdAt: answer.createdAt }]));
            } catch (error) {
                setMessages(current => mergeMessages(current, [{ id: crypto.randomUUID(), role: "model", content: error instanceof Error ? error.message : t.sendFailed, createdAt: new Date().toISOString() }]));
            } finally { setIsSending(false); }
            return;
        }
        const optimistic: ChatMessage = { id: crypto.randomUUID(), role: "user", content: prompt, createdAt: new Date().toISOString(), status: "sent" };
        setMessages(current => mergeMessages(current, [optimistic]));
        try {
            const response = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: selectedId, content: prompt, type: "text", messageId: optimistic.id }) });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || t.sendFailed);
            const confirmed: ChatMessage = { id: payload.message.id, role: "user", content: payload.message.content, createdAt: payload.message.created_at, status: payload.message.status };
            setMessages(current => mergeMessages(confirmed.id === optimistic.id ? current : current.filter(message => message.id !== optimistic.id), [confirmed]));
        } catch {
            setMessages(current => mergeMessages(current.filter(message => message.id !== optimistic.id), [{ id: crypto.randomUUID(), role: "model", content: t.sendFailed, createdAt: new Date().toISOString() }]));
        } finally { setIsSending(false); loadConversations(); }
    }

    async function sendVoiceMessage(audio: Blob, mimeType: string, durationSeconds: number) {
        if (!supabase || !user || selectedId === "ai-gemini" || !activeConvId) throw new Error(t.voiceFailed);
        setIsSending(true);
        const optimisticId = crypto.randomUUID();
        const localUrl = URL.createObjectURL(audio);
        const extension = mimeType === "audio/mp4" ? "m4a" : mimeType === "audio/ogg" ? "ogg" : mimeType === "audio/mpeg" ? "mp3" : mimeType === "audio/wav" ? "wav" : "webm";
        const path = `${activeConvId}/${crypto.randomUUID()}.${extension}`;
        setMessages(current => [...current, { id: optimisticId, role: "user", content: "", createdAt: new Date().toISOString(), status: "sent", type: "audio", audioUrl: localUrl, audioPath: path, durationSeconds }]);
        try {
            const upload = await supabase.storage.from("voice-notes").upload(path, audio, { contentType: mimeType, upsert: false });
            if (upload.error) throw new Error(upload.error.message);
            const { data, error } = await supabase.rpc("send_voice_message", { conv_id: activeConvId, storage_path: path, mime_type: mimeType, size_bytes: audio.size, duration_seconds: durationSeconds, message_id: optimisticId });
            if (error) throw new Error(error.message);
            const created = data as DbMessageRow;
            const { data: signed } = await supabase.storage.from("voice-notes").createSignedUrl(path, 86400);
            const confirmed: ChatMessage = { id: created.id, role: "user", content: "", createdAt: created.created_at, status: created.status, type: "audio", audioUrl: signed?.signedUrl ?? null, audioPath: path, durationSeconds };
            setMessages(current => mergeMessages(confirmed.id === optimisticId ? current : current.filter(message => message.id !== optimisticId), [confirmed]));
            if (signed?.signedUrl) window.setTimeout(() => URL.revokeObjectURL(localUrl), 5000);
        } catch (error) {
            // La RPC a pu aboutir malgré la réponse perdue : on garde alors le message et son fichier.
            const { data: stored } = await supabase.from("messages")
                .select("id, conversation_id, sender_id, content, type, status, created_at, attachments(url, mime_type, duration_seconds)")
                .eq("id", optimisticId).maybeSingle();
            if (stored) {
                const [confirmed] = await toMessages([stored as unknown as DbMessageRow]);
                if (confirmed) {
                    setMessages(current => mergeMessages(current.filter(message => message.id !== optimisticId), [confirmed]));
                    URL.revokeObjectURL(localUrl);
                    return;
                }
            }
            setMessages(current => current.filter(message => message.id !== optimisticId));
            URL.revokeObjectURL(localUrl);
            // Fichier orphelin (aucun message créé) : on le supprime pour ne pas gonfler le stockage.
            await supabase.storage.from("voice-notes").remove([path]);
            throw error;
        } finally { setIsSending(false); loadConversations(); }
    }

    async function toggleBlock() {
        if (!supabase || !user) return;
        const targetId = selectedConversation.otherUserId;
        if (!targetId) return;
        if (blockedIds.has(targetId)) await supabase.from("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", targetId);
        else await supabase.from("blocks").insert({ blocker_id: user.id, blocked_id: targetId });
        setMenuOpen(false);
        await loadBlocks();
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
            <ConversationList items={visibleConversations} selectedId={selectedId} onSelect={id => { setSelectedId(id); setShowList(false); setMenuOpen(false); }} />
            <button className="profile-footer" type="button" aria-label={t.profile} onClick={() => setProfileOpen(true)}><img className="avatar" src={profile?.avatar || "/images/default-avatar.svg"} alt="" /><span>{profile?.name || user.email}</span><span>✎</span></button>
        </aside>
        <section className="chat-panel">
            <header className="chat-header">
                <button className="icon-button back-button" type="button" onClick={() => setShowList(true)}>←</button>
                <img className="avatar" src={selectedConversation.avatar || (selectedConversation.id === "ai-gemini" ? "/images/gemini-avatar.svg" : "/images/default-avatar.svg")} alt="" />
                <div className="chat-title"><h2>{selectedConversation.name}</h2><p>{selectedConversation.id === "ai-gemini" ? `${t.online} · ${t.assistant}` : selectedConversation.online ? t.online : t.offline}</p></div>
                {selectedConversation.otherUserId && <div className="chat-menu-wrap">
                    <button className="icon-button" type="button" aria-label={t.block} onClick={() => setMenuOpen(open => !open)}>•••</button>
                    {menuOpen && <>
                        <div className="chat-menu-backdrop" onClick={() => setMenuOpen(false)} />
                        <div className="chat-menu">
                            <button type="button" onClick={toggleBlock}>{blockedIds.has(selectedConversation.otherUserId) ? t.unblock : t.block}</button>
                        </div>
                    </>}
                </div>}
            </header>
            <div className="message-list" ref={listRef} onScroll={handleListScroll}>
                {loadingOlder && <div className="list-status"><span className="spinner" aria-hidden="true" />{t.loadingOlder}</div>}
                {!loadingOlder && !hasOlder && hasHistory && <div className="list-status">{t.historyStart}</div>}
                {messages.map(message => <MessageBubble key={message.id} content={message.content} outgoing={message.role === "user"} createdAt={message.createdAt} status={message.status} isAudio={message.type === "audio"} audioUrl={message.audioUrl} audioPath={message.audioPath} onResignAudio={resignAudioUrl} audioFallback={t.voiceUnavailable} />)}
                {isSending && selectedId === "ai-gemini" && <div className="message-row"><div className="bubble">{t.typing}</div></div>}
            </div>
            {convBlocked && selectedConversation.otherUserId ? <div className="blocked-banner">
                <span>{blockedIds.has(selectedConversation.otherUserId) ? t.blockedByYou : t.blockedNotice}</span>
                {blockedIds.has(selectedConversation.otherUserId) && <button type="button" onClick={toggleBlock}>{t.unblock}</button>}
            </div> : <MessageInput key={activeConvId ?? "pending"} placeholder={t.write} disabled={isSending} allowAudio={selectedId !== "ai-gemini" && Boolean(activeConvId)} labels={{ record: t.record, stop: t.stop, cancel: t.cancel, unavailable: t.micUnavailable, failed: t.voiceFailed }} onSend={sendMessage} onSendAudio={sendVoiceMessage} />}
        </section>
        {profileOpen && user && <ProfileModal userId={user.id} email={user.email} name={profile?.name ?? ""} avatar={profile?.avatar ?? null} labels={{ title: t.profile, changePhoto: t.changePhoto, uploading: t.uploading, badType: t.photoBadType, failed: t.photoFailed, logout: t.logout, close: t.close }} onAvatarSaved={url => setProfile(current => current ? { ...current, avatar: url } : current)} onClose={() => setProfileOpen(false)} onLogout={logout} />}
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
