"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { askGemini, type GeminiMessage } from "../lib/gemini";
import { createClient } from "../lib/supabase/client";
import { formatLastSeen, isRecentlyOnline } from "../lib/format";
import { ConversationList, type ConversationListItem } from "./sidebar/ConversationList";
import { MessageBubble } from "./chat/MessageBubble";
import { MessageInput } from "./chat/MessageInput";
import { ProfileModal } from "./profile/ProfileModal";
import { ContactProfileModal, type ContactProfile } from "./profile/ContactProfileModal";

type Language = "fr" | "en";
type ChatMessage = GeminiMessage & { id: string; createdAt: string; status?: "sent" | "delivered" | "read"; type?: string; audioUrl?: string | null; audioPath?: string | null; durationSeconds?: number | null; senderId?: string | null };
type Profile = { id: string; name: string; username: string | null; avatar: string | null; online: boolean; status?: string | null; last_seen?: string | null };
type DbAttachment = { url: string; mime_type: string; duration_seconds: number | null };
type DbMessageRow = { id: string; conversation_id: string; sender_id: string | null; content: string; type: string; status: "sent" | "delivered" | "read"; created_at: string; attachments?: DbAttachment[] | null };
type ConvShape = {
    id: string; type: "ai" | "direct" | "group"; name: string; created_at: string;
    messages: { content: string; created_at: string; type: string; sender_id: string | null }[] | null;
    conversation_members: { users: Profile | null }[] | null;
};

const copy = {
    fr: { brand: "PULSE", private: "MESSAGERIE PRIVÉE", title: "Les conversations qui comptent.", subtitle: "Un espace vivant pour parler, créer et garder le fil.", login: "Se connecter", register: "Créer un compte", name: "Nom affiché", email: "Email", password: "Mot de passe", enter: "Entrer dans Pulse", create: "Créer mon espace", search: "Rechercher une conversation", messages: "Messages", newChat: "Nouvelle conversation", assistant: "Assistant IA", online: "En ligne", offline: "Hors ligne", write: "Écrire un message...", aiGreeting: "Bonjour. Je peux t'aider à rédiger, résumer ou organiser une idée.", supabaseMissing: "Supabase n'est pas configuré. Ajoute les variables dans .env.local puis redémarre Next.js.", searchUser: "Rechercher un utilisateur (nom ou @pseudo)", noUserFound: "Aucun utilisateur trouvé.", close: "Fermer", sendFailed: "Envoi impossible. Réessaie.", typing: "Gemini écrit...", block: "Bloquer le contact", unblock: "Débloquer le contact", blockedByYou: "Vous avez bloqué ce contact. Aucun message ne peut être envoyé.", blockedNotice: "Cette conversation est bloquée. Aucun message ne peut être envoyé.", record: "Enregistrer un message vocal", stop: "Envoyer le vocal", cancel: "Annuler l'enregistrement", micUnavailable: "L'enregistrement vocal n'est pas disponible sur cet appareil.", voiceFailed: "Envoi du vocal impossible. Réessaie.", voiceUnavailable: "Vocal indisponible", voicePreview: "Message vocal", profile: "Mon profil", changePhoto: "Changer la photo", uploading: "Envoi en cours...", photoBadType: "Choisis une image PNG, JPEG ou WebP.", photoFailed: "Impossible de mettre à jour la photo.", logout: "Se déconnecter", loadingOlder: "Chargement des messages…", historyStart: "Début de la conversation", username: "Pseudo", bio: "Statut", bioPlaceholder: "Disponible", save: "Enregistrer", saving: "Enregistrement…", saved: "Profil enregistré.", usernameTaken: "Ce pseudo est déjà pris.", usernameInvalid: "Pseudo invalide : 3 à 30 caractères (minuscules, chiffres, . ou _).", contactProfile: "Profil du contact", noBio: "Aucun statut.", typingUser: "en train d'écrire…", directChat: "Discussion", newGroup: "Nouveau groupe", groupNamePlaceholder: "Nom du groupe", createGroup: "Créer le groupe", creating: "Création…", groupFailed: "Création du groupe impossible. Réessaie.", members: "membres", member: "Membre", you: "Vous", newMessage: "Nouveau message", notifyEnable: "Activer les notifications", notifyDisable: "Désactiver les notifications", notifyDenied: "Notifications bloquées par les réglages du navigateur.", pwShow: "Afficher le mot de passe", pwHide: "Masquer le mot de passe", confirmPassword: "Confirmer le mot de passe", pwMismatch: "Les deux mots de passe ne correspondent pas.", confirmEmail: "Compte créé. Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.", errAlreadyRegistered: "Un compte existe déjà avec cet email. Connecte-toi ou utilise un autre email.", errInvalidCredentials: "Email ou mot de passe incorrect.", errEmailNotConfirmed: "Confirme d'abord ton email, puis connecte-toi.", errInvalidEmail: "Adresse email invalide.", errWeakPassword: "Mot de passe trop faible : au moins 8 caractères.", errRateLimit: "Trop de tentatives. Patiente quelques minutes avant de réessayer.", errUnknown: "Une erreur est survenue. Réessaie." },
    en: { brand: "PULSE", private: "PRIVATE MESSAGING", title: "Conversations that matter.", subtitle: "A living space to talk, create, and keep the thread.", login: "Log in", register: "Create account", name: "Display name", email: "Email", password: "Password", enter: "Enter Pulse", create: "Create my space", search: "Search a conversation", messages: "Messages", newChat: "New conversation", assistant: "AI Assistant", online: "Online", offline: "Offline", write: "Write a message...", aiGreeting: "Hello. I can help you draft, summarize, or organize an idea.", supabaseMissing: "Supabase is not configured. Add the variables to .env.local and restart Next.js.", searchUser: "Search a user (name or @username)", noUserFound: "No user found.", close: "Close", sendFailed: "Could not send. Try again.", typing: "Gemini is typing...", block: "Block this contact", unblock: "Unblock this contact", blockedByYou: "You blocked this contact. No message can be sent.", blockedNotice: "This conversation is blocked. No message can be sent.", record: "Record a voice message", stop: "Send the voice message", cancel: "Cancel the recording", micUnavailable: "Voice recording is not available on this device.", voiceFailed: "Could not send the voice message. Try again.", voiceUnavailable: "Voice message unavailable", voicePreview: "Voice message", profile: "My profile", changePhoto: "Change photo", uploading: "Uploading...", photoBadType: "Choose a PNG, JPEG or WebP image.", photoFailed: "Could not update the photo.", logout: "Log out", loadingOlder: "Loading messages…", historyStart: "Start of the conversation", username: "Username", bio: "Status", bioPlaceholder: "Available", save: "Save", saving: "Saving…", saved: "Profile saved.", usernameTaken: "This username is already taken.", usernameInvalid: "Invalid username: 3-30 characters (lowercase letters, digits, . or _).", contactProfile: "Contact profile", noBio: "No status.", typingUser: "is typing…", directChat: "Chat", newGroup: "New group", groupNamePlaceholder: "Group name", createGroup: "Create group", creating: "Creating…", groupFailed: "Could not create the group. Try again.", members: "members", member: "Member", you: "You", newMessage: "New message", notifyEnable: "Enable notifications", notifyDisable: "Disable notifications", notifyDenied: "Notifications are blocked in your browser settings.", pwShow: "Show password", pwHide: "Hide password", confirmPassword: "Confirm password", pwMismatch: "The two passwords do not match.", confirmEmail: "Account created. Check your inbox to confirm your address, then log in.", errAlreadyRegistered: "An account already exists with this email. Log in or use another email.", errInvalidCredentials: "Incorrect email or password.", errEmailNotConfirmed: "Confirm your email first, then log in.", errInvalidEmail: "Invalid email address.", errWeakPassword: "Password too weak: at least 8 characters.", errRateLimit: "Too many attempts. Wait a few minutes before retrying.", errUnknown: "Something went wrong. Try again." }
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
    const [passwordConfirm, setPasswordConfirm] = useState("");
    const [showPw, setShowPw] = useState(false);
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
    const [contactProfile, setContactProfile] = useState<ContactProfile | null>(null);
    const [typingUser, setTypingUser] = useState<string | null>(null);
    const [hasOlder, setHasOlder] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [hasHistory, setHasHistory] = useState(false);
    const [notifyOn, setNotifyOn] = useState(false);
    const [notifyDenied, setNotifyDenied] = useState(false);
    const [groupMode, setGroupMode] = useState(false);
    const [groupName, setGroupName] = useState("");
    const [groupMembers, setGroupMembers] = useState<Profile[]>([]);
    const [groupBusy, setGroupBusy] = useState(false);
    const [groupError, setGroupError] = useState("");
    const [roster, setRoster] = useState<Record<string, string>>({});
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
    const typingChannelRef = useRef<RealtimeChannel | null>(null);
    const typingTimerRef = useRef<number | null>(null);
    const lastTypingSentRef = useRef(0);
    const updateTimerRef = useRef<number | null>(null);
    const updateNeedsRefreshRef = useRef(false);
    const notifyOnRef = useRef(false);
    notifyOnRef.current = notifyOn;
    const conversationsRef = useRef<ConversationListItem[]>([]);
    conversationsRef.current = conversations;
    const rosterRef = useRef<Record<string, string>>({});
    rosterRef.current = roster;
    const tRef = useRef(t);
    tRef.current = t;

    useEffect(() => {
        const savedLanguage = window.localStorage.getItem("pulse-language");
        if (savedLanguage === "en" || savedLanguage === "fr") setLanguage(savedLanguage);
        setDark(window.localStorage.getItem("pulse-theme") === "dark");
        setNotifyOn(window.localStorage.getItem("pulse-notify") === "1");
        if (typeof Notification !== "undefined") setNotifyDenied(Notification.permission === "denied");
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

    // Profil + présence : « en ligne » avec battement régulier, dernière activité à la déconnexion
    useEffect(() => {
        if (!supabase || !user) return;
        let active = true;
        // Les builders PostgREST sont paresseux : sans .then(), la requête n'est jamais envoyée.
        const touch = (online: boolean) => {
            void supabase
                .from("users")
                .update({ online, last_seen: new Date().toISOString() })
                .eq("id", user.id)
                .then(
                    ({ error }) => { if (error) console.warn("presence:", error.message); },
                    () => {}
                );
        };
        (async () => {
            await supabase.from("users").upsert({ id: user.id, name: user.email?.split("@")[0] ?? "" }, { onConflict: "id", ignoreDuplicates: true });
            touch(true);
            const { data } = await supabase.from("users").select("id, name, username, avatar, online, status, last_seen").eq("id", user.id).maybeSingle();
            if (active && data) setProfile(data);
        })();
        const heartbeat = window.setInterval(() => touch(true), 60000);
        const goOffline = () => touch(false);
        window.addEventListener("pagehide", goOffline);
        return () => { active = false; window.clearInterval(heartbeat); window.removeEventListener("pagehide", goOffline); goOffline(); };
    }, [supabase, user]);

    // L'horodatage « vu il y a … » se rafraîchit tout seul, même sans événement réseau
    const [, setClock] = useState(0);
    useEffect(() => {
        const timer = window.setInterval(() => setClock(value => value + 1), 60000);
        return () => window.clearInterval(timer);
    }, []);

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
        const [convs, unreadRows] = await Promise.all([
            supabase.from("conversation_members")
                .select("conversation_id, conversations(id, type, name, created_at, messages(id, content, created_at, type, sender_id), conversation_members(user_id, users(id, name, username, avatar, online, last_seen)))")
                .eq("user_id", user.id)
                .order("created_at", { referencedTable: "conversations.messages", ascending: false })
                .limit(1, { referencedTable: "conversations.messages" }),
            // Messages non lus reçus (sender_id non nul : les réponses IA sont exclues d'office par neq)
            supabase.from("messages").select("conversation_id").neq("status", "read").neq("sender_id", user.id).limit(500)
        ]);
        const unreadByConversation = new Map<string, number>();
        for (const row of (unreadRows.data ?? []) as { conversation_id: string }[]) {
            unreadByConversation.set(row.conversation_id, (unreadByConversation.get(row.conversation_id) ?? 0) + 1);
        }
        const rows = (convs.data ?? []) as unknown as { conversations: ConvShape | null }[];
        const loaded = rows
            .map(row => row.conversations)
            .filter((conv): conv is ConvShape => conv !== null && conv.type !== "ai");
        // Annuaire local des membres : sert aux noms d'expéditeur dans les groupes et aux notifications.
        const names: Record<string, string> = {};
        for (const conv of loaded) for (const member of conv.conversation_members ?? []) {
            if (member.users && member.users.id !== user.id) names[member.users.id] = member.users.name || member.users.username || "";
        }
        if (Object.keys(names).length > 0) setRoster(current => ({ ...current, ...names }));
        const items: ConversationListItem[] = loaded.map(conv => {
            const other = (conv.conversation_members ?? []).map(member => member.users).find(u => u && u.id !== user.id);
            const last = (conv.messages ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
            const previewText = last ? (last.type === "audio" ? copy[language].voicePreview : last.content) : "";
            const author = conv.type === "group" && last?.sender_id
                ? (last.sender_id === user.id ? copy[language].you : names[last.sender_id] ?? copy[language].member)
                : null;
            return {
                id: conv.id,
                name: conv.type === "direct" && other ? (other.name || other.username || "Membre") : conv.name,
                preview: author ? `${author}: ${previewText}` : previewText,
                online: conv.type === "direct" ? other?.online : undefined,
                avatar: conv.type === "direct" && other?.avatar ? other.avatar : undefined,
                otherUserId: conv.type === "direct" && other ? other.id : undefined,
                otherLastSeen: conv.type === "direct" ? other?.last_seen ?? null : undefined,
                unread: unreadByConversation.get(conv.id) ?? 0,
                isGroup: conv.type === "group",
                memberCount: (conv.conversation_members ?? []).length
            };
        });
        setConversations(items);
    }, [supabase, user, language]);

    useEffect(() => { loadConversations(); }, [loadConversations]);

    // Accusés de lecture : l'expéditeur ne peut pas marquer ses propres messages,
    // d'où la RPC (SECURITY DEFINER) qui vérifie l'appartenance à la conversation.
    const markActiveRead = useCallback(async (conversationId: string) => {
        if (!supabase || !user || !conversationId || selectedRef.current === "ai-gemini") return;
        const { data, error } = await supabase.rpc("mark_conversation_read", { conv_id: conversationId });
        if (error) return;
        if (typeof data === "number" && data > 0) setConversations(current => current.map(item => item.id === conversationId ? { ...item, unread: 0 } : item));
    }, [supabase, user]);

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

    // Complète l'annuaire pour les expéditeurs pas encore croisés dans une conversation chargée.
    const resolveNames = useCallback(async (ids: string[]) => {
        if (!supabase || ids.length === 0) return;
        const { data } = await supabase.from("users").select("id, name, username").in("id", ids);
        if (!data?.length) return;
        const found: Record<string, string> = {};
        for (const row of data as { id: string; name: string; username: string | null }[]) found[row.id] = row.name || row.username || "";
        setRoster(current => ({ ...current, ...found }));
    }, [supabase]);

    const toMessages = useCallback(async (rows: DbMessageRow[]): Promise<ChatMessage[]> => {
        if (!supabase || !user) return [];
        const unknownSenders = [...new Set(rows.map(row => row.sender_id).filter((id): id is string => id !== null && id !== user.id && !(id in rosterRef.current)))];
        if (unknownSenders.length > 0) void resolveNames(unknownSenders);
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
                senderId: row.sender_id,
                audioUrl: row.type === "audio" && attachment ? signedUrls.get(attachment.url) ?? null : null,
                audioPath: row.type === "audio" && attachment ? attachment.url : null,
                durationSeconds: attachment?.duration_seconds ?? null
            };
        });
    }, [supabase, user, resolveNames]);

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
            void markActiveRead(activeConvId);
        })();
    }, [activeConvId, fetchPage, markActiveRead]);

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

    // Les UPDATE de messages arrivent en rafale (lecture d'un lot) : un seul rafraîchissement différé
    const scheduleUpdateRefresh = useCallback((refreshActive: boolean) => {
        if (refreshActive) updateNeedsRefreshRef.current = true;
        if (updateTimerRef.current !== null) return;
        updateTimerRef.current = window.setTimeout(() => {
            updateTimerRef.current = null;
            if (updateNeedsRefreshRef.current) { updateNeedsRefreshRef.current = false; void refreshNewest(); }
            void loadConversations();
        }, 400);
    }, [refreshNewest, loadConversations]);

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

    // Realtime : nouveaux messages, accusés de lecture, nouvelles conversations, présence
    useEffect(() => {
        if (!supabase || !user) return;
        const channel = supabase.channel("pulse-realtime")
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => {
                const row = payload.new as { conversation_id: string; sender_id: string | null; content: string; type: string };
                const active = selectedRef.current === "ai-gemini" ? aiConvRef.current : selectedRef.current;
                const isActive = Boolean(active && row.conversation_id === active);
                if (isActive) {
                    reloadMessagesRef.current();
                    if (document.visibilityState === "visible") void markActiveRead(active!);
                }
                // Notification seulement pour un message reçu ailleurs, ou onglet en arrière-plan
                if (row.sender_id && row.sender_id !== user.id && (document.visibilityState !== "visible" || !isActive)) showMessageNotification(row);
                loadConversations();
            })
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, payload => {
                // Nos propres messages passés à « lu » par le destinataire : on rafraîchit pour les ✓✓
                const row = payload.new as { conversation_id?: string; sender_id?: string | null };
                const active = selectedRef.current === "ai-gemini" ? aiConvRef.current : selectedRef.current;
                scheduleUpdateRefresh(Boolean(active && row.conversation_id === active && row.sender_id === user.id));
            })
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_members", filter: `user_id=eq.${user.id}` }, () => loadConversations())
            .on("postgres_changes", { event: "UPDATE", schema: "public", table: "users" }, payload => {
                const row = payload.new as Partial<Profile> & { id?: string };
                if (row?.id) setContactProfile(current => current && current.id === row.id ? { ...current, ...row } : current);
                loadConversations();
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [supabase, user, loadConversations, markActiveRead, scheduleUpdateRefresh]);

    // Revenir sur l'onglet vaut lecture de la conversation ouverte
    useEffect(() => {
        if (!supabase || !user) return;
        const onVisible = () => {
            if (document.visibilityState !== "visible") return;
            const active = selectedRef.current === "ai-gemini" ? aiConvRef.current : selectedRef.current;
            if (!active) return;
            void markActiveRead(active);
            reloadMessagesRef.current();
        };
        window.addEventListener("focus", onVisible);
        document.addEventListener("visibilitychange", onVisible);
        return () => { window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
    }, [supabase, user, markActiveRead]);

    // « en train d'écrire… » : diffusion éphémère sur le canal de la conversation ouverte
    useEffect(() => {
        if (!supabase || !user || !activeConvId) { setTypingUser(null); return; }
        const channel = supabase.channel(`typing-${activeConvId}`, { config: { broadcast: { self: false } } })
            .on("broadcast", { event: "typing" }, ({ payload }) => {
                const data = payload as { userId?: string } | null;
                if (!data?.userId || data.userId === user.id) return;
                setTypingUser(data.userId);
                if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current);
                typingTimerRef.current = window.setTimeout(() => { typingTimerRef.current = null; setTypingUser(null); }, 3500);
            })
            .subscribe();
        typingChannelRef.current = channel;
        return () => {
            typingChannelRef.current = null;
            if (typingTimerRef.current !== null) { window.clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
            setTypingUser(null);
            void supabase.removeChannel(channel);
        };
    }, [supabase, user, activeConvId]);

    function notifyTyping() {
        const channel = typingChannelRef.current;
        if (!channel || !user || selectedRef.current === "ai-gemini") return;
        const now = Date.now();
        if (now - lastTypingSentRef.current < 2500) return;
        lastTypingSentRef.current = now;
        void channel.send({ type: "broadcast", event: "typing", payload: { userId: user.id, name: profile?.name ?? "" } });
    }

    // Notifications du navigateur : la permission est demandée sur un geste explicite (cloche).
    async function toggleNotifications() {
        if (typeof Notification === "undefined") return;
        if (notifyOn) { setNotifyOn(false); window.localStorage.setItem("pulse-notify", "0"); return; }
        if (Notification.permission === "denied") { setNotifyDenied(true); return; }
        const granted = Notification.permission === "granted" || (await Notification.requestPermission()) === "granted";
        setNotifyDenied(!granted);
        setNotifyOn(granted);
        window.localStorage.setItem("pulse-notify", granted ? "1" : "0");
    }

    function showMessageNotification(row: { conversation_id: string; sender_id: string | null; content: string; type: string }) {
        if (!notifyOnRef.current || typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const labels = tRef.current;
        const conv = conversationsRef.current.find(item => item.id === row.conversation_id);
        const sender = row.sender_id ? rosterRef.current[row.sender_id] ?? labels.member : "";
        const title = conv?.isGroup && conv.name ? (sender ? `${sender} · ${conv.name}` : conv.name) : conv?.name || sender || labels.newMessage;
        try {
            const note = new Notification(title, { body: row.type === "audio" ? labels.voicePreview : row.content, tag: row.conversation_id });
            note.onclick = () => { window.focus(); setSelectedId(row.conversation_id); setShowList(false); setMenuOpen(false); note.close(); };
        } catch { /* certains environnements (Android) exigent un service worker */ }
    }

    const visibleConversations = useMemo(
        () => [aiEntry(language), ...conversations].filter(item => item.name.toLowerCase().includes(query.toLowerCase())),
        [conversations, query, language]
    );
    const selectedConversation = visibleConversations.find(item => item.id === selectedId) ?? aiEntry(language);
    const otherId = selectedConversation.otherUserId;
    const isGroup = Boolean(selectedConversation.isGroup);
    const selectedRecentlyOnline = otherId
        ? isRecentlyOnline(selectedConversation.online, selectedConversation.otherLastSeen)
        : Boolean(selectedConversation.online);
    const presenceSubtitle = selectedConversation.id === "ai-gemini"
        ? `${t.online} · ${t.assistant}`
        : isGroup
            ? typingUser !== null ? t.typingUser : `${selectedConversation.memberCount ?? 1} ${t.members}`
            : otherId
                ? typingUser !== null
                    ? t.typingUser
                    : selectedRecentlyOnline ? t.online : selectedConversation.otherLastSeen ? formatLastSeen(selectedConversation.otherLastSeen, language) : t.offline
                : selectedConversation.online ? t.online : t.offline;
    const headerAvatar = selectedConversation.isGroup
        ? <span className="avatar group-avatar" aria-hidden="true">👥</span>
        : <img className="avatar" src={selectedConversation.avatar || (selectedConversation.id === "ai-gemini" ? "/images/gemini-avatar.svg" : "/images/default-avatar.svg")} alt="" />;

    function authErrorMessage(message: string): string {
        const normalized = message.toLowerCase();
        if (normalized.includes("already registered")) return t.errAlreadyRegistered;
        if (normalized.includes("invalid login credentials")) return t.errInvalidCredentials;
        if (normalized.includes("email not confirmed")) return t.errEmailNotConfirmed;
        if (normalized.includes("invalid format") || normalized.includes("validate email")) return t.errInvalidEmail;
        if (normalized.includes("password should be") || normalized.includes("weak password") || normalized.includes("password is too short")) return t.errWeakPassword;
        if (normalized.includes("rate limit") || normalized.includes("too many")) return t.errRateLimit;
        return message || t.errUnknown;
    }

    async function submitAuth(event: FormEvent) {
        event.preventDefault();
        setAuthError("");
        if (!supabase) { setAuthError(t.supabaseMissing); return; }
        const email = authForm.email.trim();
        const name = authForm.name.trim();
        if (authMode === "register" && authForm.password !== passwordConfirm) { setAuthError(t.pwMismatch); return; }
        const result = authMode === "login"
            ? await supabase.auth.signInWithPassword({ email, password: authForm.password })
            : await supabase.auth.signUp({ email, password: authForm.password, options: { data: { name: name || email.split("@")[0] } } });
        if (result.error) setAuthError(authErrorMessage(result.error.message));
        else if (result.data.session && result.data.user) setUser({ id: result.data.user.id, email: result.data.user.email });
        else if ((result.data.user?.identities?.length ?? 0) === 0) setAuthError(t.errAlreadyRegistered);
        else setAuthError(t.confirmEmail);
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

    async function toggleBlockFor(targetId: string) {
        if (!supabase || !user) return;
        if (blockedIds.has(targetId)) await supabase.from("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", targetId);
        else await supabase.from("blocks").insert({ blocker_id: user.id, blocked_id: targetId });
        setMenuOpen(false);
        await loadBlocks();
    }

    function toggleBlock() {
        const targetId = selectedConversation.otherUserId;
        if (targetId) return toggleBlockFor(targetId);
    }

    async function openContactProfile(targetId: string) {
        if (!supabase) return;
        const { data } = await supabase.from("users").select("id, name, username, avatar, online, status, last_seen").eq("id", targetId).maybeSingle();
        if (data) setContactProfile(data as ContactProfile);
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

    function closeNewChat() {
        setNewChatOpen(false);
        setUserQuery("");
        setUserResults([]);
        setGroupMode(false);
        setGroupName("");
        setGroupMembers([]);
        setGroupError("");
    }

    function toggleGroupMember(found: Profile) {
        setGroupError("");
        setGroupMembers(current => current.some(member => member.id === found.id) ? current.filter(member => member.id !== found.id) : [...current, found]);
    }

    async function createGroup() {
        const name = groupName.trim();
        if (!supabase || !user || groupBusy || !name || groupMembers.length === 0) return;
        setGroupBusy(true);
        setGroupError("");
        try {
            // Id généré côté client : INSERT ... RETURNING échouerait, la politique SELECT exige d'être membre.
            const id = crypto.randomUUID();
            const created = await supabase.from("conversations").insert({ id, type: "group", name });
            if (created.error) throw new Error(created.error.message);
            // L'adhésion du créateur passe par auth.uid() = user_id ; elle ouvre ensuite l'insertion des autres.
            const mine = await supabase.from("conversation_members").insert({ conversation_id: id, user_id: user.id });
            if (mine.error) throw new Error(mine.error.message);
            const others = await supabase.from("conversation_members").insert(groupMembers.map(member => ({ conversation_id: id, user_id: member.id })));
            if (others.error) throw new Error(others.error.message);
            closeNewChat();
            await loadConversations();
            setSelectedId(id);
            setShowList(false);
        } catch {
            setGroupError(t.groupFailed);
        } finally { setGroupBusy(false); }
    }

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
            closeNewChat();
            await loadConversations();
            if (conversationId) { setSelectedId(conversationId); setShowList(false); }
        } finally { setStartBusy(false); }
    }

    if (!user) return <main className="auth"><section className="auth-card"><div className="brand"><span className="brand-mark">✦</span>{t.brand}</div><p className="eyebrow">{t.private}</p><h1>{t.title}</h1><p>{t.subtitle}</p><div className="top-actions"><button className="icon-button" onClick={() => setLanguage(language === "fr" ? "en" : "fr")}>{language.toUpperCase()}</button><button className="icon-button" onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</button></div><div className="auth-tabs"><button className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAuthError(""); }}>{t.login}</button><button className={authMode === "register" ? "active" : ""} onClick={() => { setAuthMode("register"); setAuthError(""); }}>{t.register}</button></div><form className="auth-form" onSubmit={submitAuth}>{authMode === "register" && <label>{t.name}<input required autoComplete="name" value={authForm.name} onChange={event => setAuthForm({ ...authForm, name: event.target.value })} /></label>}<label>{t.email}<input required type="email" autoComplete="email" value={authForm.email} onChange={event => setAuthForm({ ...authForm, email: event.target.value })} /></label><label>{t.password}<span className="pw-wrap"><input required minLength={8} type={showPw ? "text" : "password"} autoComplete={authMode === "login" ? "current-password" : "new-password"} value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} /><button type="button" className="pw-toggle" aria-label={showPw ? t.pwHide : t.pwShow} title={showPw ? t.pwHide : t.pwShow} onClick={() => setShowPw(!showPw)}>{showPw ? "🙈" : "👁"}</button></span></label>{authMode === "register" && <label>{t.confirmPassword}<input required minLength={8} type={showPw ? "text" : "password"} autoComplete="new-password" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} /></label>}<button className="primary" type="submit">{authMode === "login" ? t.enter : t.create}</button>{authError && <span className="error">{authError}</span>}</form></section></main>;

    return <main className={`pulse-shell ${showList ? "show-list" : ""}`}>
        <aside className="pulse-sidebar">
            <header className="pulse-topbar"><div className="brand"><span className="brand-mark">✦</span>{t.brand}</div><div className="top-actions"><button className={`icon-button ${notifyOn ? "notify-on" : ""}`} type="button" onClick={() => void toggleNotifications()} aria-label={notifyOn ? t.notifyDisable : t.notifyEnable} title={notifyDenied ? t.notifyDenied : notifyOn ? t.notifyDisable : t.notifyEnable}>{notifyOn ? "🔔" : "🔕"}</button><button className="icon-button" onClick={() => setLanguage(language === "fr" ? "en" : "fr")}>{language.toUpperCase()}</button><button className="icon-button" onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</button></div></header>
            <div className="search"><input aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} /></div>
            <div className="sidebar-heading"><strong>{t.messages}</strong><button className="new-chat" aria-label={t.newChat} type="button" onClick={() => setNewChatOpen(true)}>＋</button></div>
            <ConversationList items={visibleConversations} selectedId={selectedId} onSelect={id => { setSelectedId(id); setShowList(false); setMenuOpen(false); }} />
            <button className="profile-footer" type="button" aria-label={t.profile} onClick={() => setProfileOpen(true)}><img className="avatar" src={profile?.avatar || "/images/default-avatar.svg"} alt="" /><span>{profile?.name || user.email}</span><span>✎</span></button>
        </aside>
        <section className="chat-panel">
            <header className="chat-header">
                <button className="icon-button back-button" type="button" onClick={() => setShowList(true)}>←</button>
                {otherId
                    ? <button className="chat-identity" type="button" onClick={() => void openContactProfile(otherId)}>
                        {headerAvatar}
                        <div className="chat-title"><h2>{selectedConversation.name}</h2><p className={typingUser !== null ? "typing" : selectedRecentlyOnline ? "" : "muted"}>{presenceSubtitle}</p></div>
                    </button>
                    : <>
                        {headerAvatar}
                        <div className="chat-title"><h2>{selectedConversation.name}</h2><p className={typingUser !== null ? "typing" : ""}>{presenceSubtitle}</p></div>
                    </>}
                {otherId && <div className="chat-menu-wrap">
                    <button className="icon-button" type="button" aria-label={t.block} onClick={() => setMenuOpen(open => !open)}>•••</button>
                    {menuOpen && <>
                        <div className="chat-menu-backdrop" onClick={() => setMenuOpen(false)} />
                        <div className="chat-menu">
                            <button type="button" onClick={() => void toggleBlock()}>{blockedIds.has(otherId) ? t.unblock : t.block}</button>
                        </div>
                    </>}
                </div>}
            </header>
            <div className="message-list" ref={listRef} onScroll={handleListScroll}>
                {loadingOlder && <div className="list-status"><span className="spinner" aria-hidden="true" />{t.loadingOlder}</div>}
                {!loadingOlder && !hasOlder && hasHistory && <div className="list-status">{t.historyStart}</div>}
                {messages.map(message => <MessageBubble key={message.id} content={message.content} outgoing={message.role === "user"} createdAt={message.createdAt} status={message.status} isAudio={message.type === "audio"} audioUrl={message.audioUrl} audioPath={message.audioPath} onResignAudio={resignAudioUrl} audioFallback={t.voiceUnavailable} senderName={isGroup && message.role !== "user" ? (message.senderId ? roster[message.senderId] ?? t.member : undefined) : undefined} />)}
                {isSending && selectedId === "ai-gemini" && <div className="message-row"><div className="bubble">{t.typing}</div></div>}
            </div>
            {convBlocked && selectedConversation.otherUserId ? <div className="blocked-banner">
                <span>{blockedIds.has(selectedConversation.otherUserId) ? t.blockedByYou : t.blockedNotice}</span>
                {blockedIds.has(selectedConversation.otherUserId) && <button type="button" onClick={toggleBlock}>{t.unblock}</button>}
            </div> : <MessageInput key={activeConvId ?? "pending"} placeholder={t.write} disabled={isSending} allowAudio={selectedId !== "ai-gemini" && Boolean(activeConvId)} labels={{ record: t.record, stop: t.stop, cancel: t.cancel, unavailable: t.micUnavailable, failed: t.voiceFailed }} onSend={sendMessage} onSendAudio={sendVoiceMessage} onTyping={notifyTyping} />}
        </section>
        {profileOpen && user && <ProfileModal userId={user.id} email={user.email} name={profile?.name ?? ""} username={profile?.username ?? null} status={profile?.status ?? null} avatar={profile?.avatar ?? null} labels={{ title: t.profile, changePhoto: t.changePhoto, uploading: t.uploading, badType: t.photoBadType, failed: t.photoFailed, logout: t.logout, close: t.close, name: t.name, username: t.username, bio: t.bio, bioPlaceholder: t.bioPlaceholder, save: t.save, saving: t.saving, saved: t.saved, usernameTaken: t.usernameTaken, usernameInvalid: t.usernameInvalid }} onSaved={values => { setProfile(current => current ? { ...current, name: values.name, username: values.username, status: values.status, avatar: values.avatar } : current); void loadConversations(); }} onClose={() => setProfileOpen(false)} onLogout={logout} />}
        {contactProfile && <ContactProfileModal profile={contactProfile} blocked={blockedIds.has(contactProfile.id)} language={language} labels={{ title: t.contactProfile, bio: t.bio, noBio: t.noBio, online: t.online, offline: t.offline, block: t.block, unblock: t.unblock, close: t.close }} onToggleBlock={() => void toggleBlockFor(contactProfile.id)} onClose={() => setContactProfile(null)} />}
        {newChatOpen && <div className="modal-overlay" onClick={closeNewChat}>
            <div className="modal" onClick={event => event.stopPropagation()}>
                <div className="modal-tabs">
                    <button className={groupMode ? "" : "active"} type="button" onClick={() => { setGroupMode(false); setGroupError(""); }}>{t.directChat}</button>
                    <button className={groupMode ? "active" : ""} type="button" onClick={() => { setGroupMode(true); setGroupError(""); }}>{t.newGroup}</button>
                </div>
                {groupMode && <input className="modal-input" maxLength={120} placeholder={t.groupNamePlaceholder} value={groupName} onChange={event => setGroupName(event.target.value)} />}
                {groupMode && groupMembers.length > 0 && <div className="group-chips">{groupMembers.map(member => <button key={member.id} className="group-chip" type="button" onClick={() => toggleGroupMember(member)}><span>{member.name || member.username}</span><span aria-hidden="true">✕</span></button>)}</div>}
                <input autoFocus className="modal-input" placeholder={t.searchUser} value={userQuery} onChange={event => setUserQuery(event.target.value)} />
                <div className="user-results">
                    {userResults.map(found => {
                        const picked = groupMode && groupMembers.some(member => member.id === found.id);
                        return <button key={found.id} className={`user-result ${picked ? "selected" : ""}`} type="button" disabled={startBusy || groupBusy} onClick={() => groupMode ? toggleGroupMember(found) : void startConversation(found)}><img className="avatar" src={found.avatar || "/images/default-avatar.svg"} alt="" /><span className="user-result-copy"><strong>{found.name || found.username}</strong>{found.username && <small> @{found.username}</small>}{isRecentlyOnline(found.online, found.last_seen) && <em className="online-label"> · {t.online}</em>}</span>{picked && <span className="user-check" aria-hidden="true">✓</span>}</button>;
                    })}
                    {userQuery.trim().length >= 2 && !usersLoading && userResults.length === 0 && <p className="modal-empty">{t.noUserFound}</p>}
                </div>
                {groupMode && <div className="modal-actions">
                    {groupError && <span className="error">{groupError}</span>}
                    <button className="primary" type="button" disabled={groupBusy || !groupName.trim() || groupMembers.length === 0} onClick={() => void createGroup()}>{groupBusy ? t.creating : t.createGroup}</button>
                </div>}
                <button className="modal-close" type="button" onClick={closeNewChat}>{t.close}</button>
            </div>
        </div>}
    </main>;
}
