import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type CallPeer = { id: string; name: string; avatar?: string | null };
export type CallKind = "audio" | "video";
export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
export type CallEndReason = "declined" | "busy" | "noAnswer" | "ended" | "failed" | null;
export type CallConnection = "ringing" | "connecting" | "active" | "left" | "declined";
export type CallTile = {
    id: string;
    name: string;
    avatar?: string | null;
    connection: CallConnection;
    stream: MediaStream | null;
    cameraOn: boolean;
    muted: boolean;
};

export type StartCallOptions = {
    conversationId: string | null;
    title: string;
    kind: CallKind;
    targets: CallPeer[];
    isGroup: boolean;
};

const ROOM_TIMEOUT_MS = 10000;
const RING_TIMEOUT_MS = 40000;
const CONNECT_TIMEOUT_MS = 35000;
const TILE_LINGER_MS = 5000;
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type PresenceMeta = { userId?: string; name?: string; avatar?: string | null };
type PeerEntry = { pc: RTCPeerConnection; ice: RTCIceCandidateInit[]; remoteSet: boolean };
type InvitePayload = {
    callId?: string;
    conversationId?: string | null;
    kind?: CallKind;
    title?: string;
    isGroup?: boolean;
    caller?: { id?: string; name?: string; avatar?: string | null };
    members?: CallPeer[];
};

export function useVoiceCall({ supabase, userId, self, blockedIds, onAccepted }: {
    supabase: SupabaseClient | null;
    userId: string | null;
    self: { name: string; avatar?: string | null };
    blockedIds: Set<string>;
    onAccepted?: (conversationId: string | null) => void;
}) {
    const [phase, setPhase] = useState<CallPhase>("idle");
    const [kind, setKind] = useState<CallKind>("audio");
    const [title, setTitle] = useState("");
    const [isGroup, setIsGroup] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [participants, setParticipants] = useState<CallTile[]>([]);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [muted, setMuted] = useState(false);
    const [cameraOn, setCameraOn] = useState(false);
    const [videoFailed, setVideoFailed] = useState(false);
    const [startedAt, setStartedAt] = useState<number | null>(null);
    const [endReason, setEndReason] = useState<CallEndReason>(null);

    const phaseRef = useRef<CallPhase>("idle");
    const userIdRef = useRef(userId);
    userIdRef.current = userId;
    const selfRef = useRef(self);
    selfRef.current = self;
    const blockedRef = useRef(blockedIds);
    blockedRef.current = blockedIds;
    const onAcceptedRef = useRef(onAccepted);
    onAcceptedRef.current = onAccepted;

    const kindRef = useRef<CallKind>("audio");
    const isGroupRef = useRef(false);
    const isCallerRef = useRef(false);
    const answeredRef = useRef(false);
    const mutedRef = useRef(false);
    const cameraOnRef = useRef(false);
    const sawPresenceRef = useRef(false);
    const targetsRef = useRef<CallPeer[]>([]);
    const declinedRef = useRef<Set<string>>(new Set());

    const pcsRef = useRef<Map<string, PeerEntry>>(new Map());
    const orphanIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
    const presenceMetaRef = useRef<Map<string, PresenceMeta>>(new Map());
    const localStreamRef = useRef<MediaStream | null>(null);
    const channelRef = useRef<RealtimeChannel | null>(null);
    const ringTimeoutRef = useRef<number | null>(null);
    const watchdogRef = useRef<number | null>(null);
    const idleTimerRef = useRef<number | null>(null);
    const toneStopRef = useRef<(() => void) | null>(null);
    const callIdRef = useRef<string | null>(null);
    const pendingInviteRef = useRef<{ callId: string; conversationId: string | null } | null>(null);
    const finishRef = useRef<(reason: CallEndReason) => void>(() => {});

    function goPhase(next: CallPhase) {
        phaseRef.current = next;
        setPhase(next);
    }

    function clearRingTimeout() {
        if (ringTimeoutRef.current !== null) {
            window.clearTimeout(ringTimeoutRef.current);
            ringTimeoutRef.current = null;
        }
    }

    function clearWatchdog() {
        if (watchdogRef.current !== null) {
            window.clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
        }
    }

    // Une connexion sans réponse ne doit pas laisser l'appel en attente indéfiniment.
    function startWatchdog() {
        clearWatchdog();
        watchdogRef.current = window.setTimeout(() => {
            watchdogRef.current = null;
            if (phaseRef.current !== "connecting") return;
            dbOwnParticipant("left");
            finishRef.current("failed");
        }, CONNECT_TIMEOUT_MS);
    }

    // Sonneries générées en WebAudio (pas de fichier à charger) ; silencieusement ignorées
    // si l'audio n'est pas autorisé dans l'onglet (aucun geste utilisateur).
    function startTone(frequency: number, onMs: number, offMs: number, gain: number) {
        stopTone();
        try {
            const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!Ctor) return;
            const ctx = new Ctor();
            void ctx.resume();
            const beep = () => {
                if (ctx.state === "closed") return;
                const osc = ctx.createOscillator();
                const amp = ctx.createGain();
                osc.type = "sine";
                osc.frequency.value = frequency;
                amp.gain.value = 0;
                osc.connect(amp).connect(ctx.destination);
                const now = ctx.currentTime;
                const end = now + onMs / 1000;
                amp.gain.linearRampToValueAtTime(gain, now + 0.03);
                amp.gain.setValueAtTime(gain, Math.max(now + 0.04, end - 0.05));
                amp.gain.linearRampToValueAtTime(0, end);
                osc.start(now);
                osc.stop(end + 0.05);
            };
            beep();
            const timer = window.setInterval(beep, onMs + offMs);
            toneStopRef.current = () => { window.clearInterval(timer); void ctx.close(); };
        } catch { /* audio indisponible */ }
    }

    function stopTone() {
        if (toneStopRef.current) {
            toneStopRef.current();
            toneStopRef.current = null;
        }
    }

    function sendRoom(event: string, payload?: unknown) {
        const channel = channelRef.current;
        if (!channel) return;
        void channel.send({ type: "broadcast", event, payload });
    }

    function trackPresence() {
        const channel = channelRef.current;
        const me = userIdRef.current;
        if (!channel || !me) return;
        void channel.track({ userId: me, name: selfRef.current.name, avatar: selfRef.current.avatar ?? null });
    }

    // Vidéo demandée mais caméra indisponible : on continue en audio plutôt que d'échouer.
    async function ensureMedia(callKind: CallKind): Promise<MediaStream | null> {
        const cached = localStreamRef.current;
        if (cached && (callKind !== "video" || cached.getVideoTracks().length > 0)) return cached;
        if (cached) {
            for (const track of cached.getTracks()) track.stop();
            localStreamRef.current = null;
            setLocalStream(null);
        }
        try {
            const stream = callKind === "video"
                ? await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } })
                : await navigator.mediaDevices.getUserMedia({ audio: true });
            localStreamRef.current = stream;
            setLocalStream(stream);
            setCameraOn(stream.getVideoTracks().length > 0);
            return stream;
        } catch {
            if (callKind !== "video") return null;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                localStreamRef.current = stream;
                setLocalStream(stream);
                setVideoFailed(true);
                return stream;
            } catch {
                return null;
            }
        }
    }

    function upsertTile(id: string, patch: Partial<CallTile>) {
        setParticipants(list => {
            const index = list.findIndex(tile => tile.id === id);
            if (index === -1) {
                return [...list, { id, name: "", avatar: null, connection: "connecting" as CallConnection, stream: null, cameraOn: false, muted: false, ...patch }];
            }
            const next = list.slice();
            next[index] = { ...next[index], ...patch };
            return next;
        });
    }

    function touchTile(id: string, meta: PresenceMeta) {
        setParticipants(list => {
            const index = list.findIndex(tile => tile.id === id);
            if (index === -1) {
                return [...list, { id, name: meta.name ?? "", avatar: meta.avatar ?? null, connection: "connecting" as CallConnection, stream: null, cameraOn: false, muted: false }];
            }
            const tile = list[index];
            const next: CallTile = { ...tile, name: meta.name || tile.name, avatar: meta.avatar ?? tile.avatar };
            if (tile.connection === "ringing") next.connection = "connecting";
            const copy = list.slice();
            copy[index] = next;
            return copy;
        });
    }

    function flushIce(entry: PeerEntry) {
        for (const candidate of entry.ice.splice(0)) void entry.pc.addIceCandidate(candidate).catch(() => {});
    }

    function queueIce(peerId: string, candidate: RTCIceCandidateInit) {
        const entry = pcsRef.current.get(peerId);
        if (!entry) {
            const list = orphanIceRef.current.get(peerId) ?? [];
            list.push(candidate);
            orphanIceRef.current.set(peerId, list);
            return;
        }
        if (entry.remoteSet) void entry.pc.addIceCandidate(candidate).catch(() => {});
        else entry.ice.push(candidate);
    }

    function createPeer(peerId: string): PeerEntry {
        const existing = pcsRef.current.get(peerId);
        if (existing) return existing;
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        const entry: PeerEntry = { pc, ice: [], remoteSet: false };
        pcsRef.current.set(peerId, entry);
        const stream = localStreamRef.current;
        if (stream) for (const track of stream.getTracks()) pc.addTrack(track, stream);
        pc.onicecandidate = event => {
            if (event.candidate) sendRoom("ice", { from: userIdRef.current, to: peerId, candidate: event.candidate.toJSON() });
        };
        pc.ontrack = event => {
            const remote = event.streams[0] ?? new MediaStream([event.track]);
            upsertTile(peerId, { stream: remote, cameraOn: remote.getVideoTracks().length > 0 });
            if (event.track.kind === "video") event.track.onmute = () => upsertTile(peerId, { cameraOn: false });
        };
        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            if (state === "connected") {
                upsertTile(peerId, { connection: "active" });
                markActive();
            } else if (state === "failed") {
                dropPeer(peerId);
                afterPeerGone();
            }
        };
        const orphan = orphanIceRef.current.get(peerId);
        if (orphan) {
            entry.ice.push(...orphan);
            orphanIceRef.current.delete(peerId);
        }
        return entry;
    }

    function dropPeer(peerId: string) {
        const entry = pcsRef.current.get(peerId);
        if (!entry) return;
        pcsRef.current.delete(peerId);
        try { entry.pc.close(); } catch { /* déjà fermée */ }
        if (phaseRef.current === "idle" || phaseRef.current === "ended") return;
        upsertTile(peerId, { connection: "left", stream: null, cameraOn: false, muted: true });
        window.setTimeout(() => {
            setParticipants(list => list.filter(tile => tile.id !== peerId || tile.connection !== "left"));
        }, TILE_LINGER_MS);
    }

    // En tête-à-tête, perdre son unique pair termine l'appel ; en groupe, on continue
    // tant qu'il reste des participants connectés.
    function afterPeerGone() {
        if (phaseRef.current !== "connecting" && phaseRef.current !== "active") return;
        if (!isGroupRef.current || pcsRef.current.size === 0) {
            if (isCallerRef.current) dbOwnParticipant("left");
            finishRef.current("ended");
        }
    }

    function markActive() {
        if (phaseRef.current !== "connecting" && phaseRef.current !== "outgoing") return;
        clearRingTimeout();
        clearWatchdog();
        stopTone();
        setStartedAt(Date.now());
        goPhase("active");
        if (!answeredRef.current) {
            answeredRef.current = true;
            dbMarkAnswered();
        }
    }

    function dbOwnParticipant(status: "declined" | "missed" | "left") {
        const client = supabase;
        const callId = callIdRef.current;
        const me = userIdRef.current;
        if (!client || !callId || !me) return;
        void client
            .from("call_participants")
            .update({ status, left_at: new Date().toISOString() })
            .eq("call_id", callId)
            .eq("user_id", me)
            .then(() => {}, () => {});
    }

    function dbCreateCall(callId: string, targetConversationId: string | null, callKind: CallKind, targets: CallPeer[]) {
        const client = supabase;
        const me = userIdRef.current;
        if (!client || !me || !targetConversationId) return;
        void (async () => {
            const now = new Date().toISOString();
            const { error } = await client.from("calls").insert({
                id: callId,
                conversation_id: targetConversationId,
                caller_id: me,
                kind: callKind,
                status: "ringing"
            });
            if (error) return;
            await client.from("call_participants").insert([
                { call_id: callId, user_id: me, status: "joined", joined_at: now },
                ...targets.map(target => ({ call_id: callId, user_id: target.id, status: "invited" }))
            ]);
        })();
    }

    function dbMarkAnswered() {
        const client = supabase;
        const callId = callIdRef.current;
        const me = userIdRef.current;
        if (!client || !callId || !me) return;
        const now = new Date().toISOString();
        void client
            .from("calls")
            .update({ status: "active", answered_at: now })
            .eq("id", callId)
            .eq("status", "ringing")
            .then(() => {}, () => {});
        void client
            .from("call_participants")
            .update({ status: "joined", joined_at: now })
            .eq("call_id", callId)
            .eq("user_id", me)
            .eq("status", "invited")
            .then(() => {}, () => {});
    }

    function dbFinish(reason: CallEndReason, shouldClose: boolean) {
        const client = supabase;
        const callId = callIdRef.current;
        const me = userIdRef.current;
        if (!client || !callId || !me || !shouldClose) return;
        void client
            .from("calls")
            .update({ status: reason === "noAnswer" ? "missed" : "ended", ended_at: new Date().toISOString() })
            .eq("id", callId)
            .in("status", ["ringing", "active"])
            .then(() => {}, () => {});
        if (isCallerRef.current) {
            void client
                .from("call_participants")
                .update({ status: "missed" })
                .eq("call_id", callId)
                .eq("status", "invited")
                .then(() => {}, () => {});
        }
    }

    function cleanup() {
        stopTone();
        clearRingTimeout();
        clearWatchdog();
        for (const entry of pcsRef.current.values()) {
            try { entry.pc.close(); } catch { /* déjà fermée */ }
        }
        pcsRef.current.clear();
        orphanIceRef.current.clear();
        if (localStreamRef.current) {
            for (const track of localStreamRef.current.getTracks()) track.stop();
            localStreamRef.current = null;
        }
        if (channelRef.current && supabase) void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        setMuted(false);
        mutedRef.current = false;
        setCameraOn(false);
        cameraOnRef.current = false;
        setLocalStream(null);
    }
    // `cleanup` est recréé à chaque rendu : on passe par une ref pour que l'effet de
    // démontage ne tourne pas à chaque re-rendu (sinon il coupe le flux et le canal).
    const cleanupRef = useRef(cleanup);
    cleanupRef.current = cleanup;

    function finish(reason: CallEndReason) {
        const joined = phaseRef.current === "connecting" || phaseRef.current === "active";
        dbFinish(reason, isCallerRef.current || (joined && pcsRef.current.size === 0));
        cleanup();
        goPhase("ended");
        setEndReason(reason);
        if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = window.setTimeout(() => {
            idleTimerRef.current = null;
            if (phaseRef.current !== "ended") return;
            goPhase("idle");
            setParticipants([]);
            setTitle("");
            setIsGroup(false);
            setConversationId(null);
            setKind("audio");
            setEndReason(null);
            setVideoFailed(false);
            setStartedAt(null);
            callIdRef.current = null;
        }, 2500);
    }
    finishRef.current = finish;

    // Négociation par pair : un seul offreur (identifiants comparés), renégociation à
    // l'arrivée d'un nouveau participant — c'est ce qui rend le maillage de groupe possible.
    function negotiate(peerId: string) {
        const existing = pcsRef.current.get(peerId);
        if (existing && (existing.remoteSet || existing.pc.signalingState !== "stable")) return;
        void (async () => {
            try {
                const entry = existing ?? createPeer(peerId);
                const offer = await entry.pc.createOffer();
                await entry.pc.setLocalDescription(offer);
                sendRoom("offer", { from: userIdRef.current, to: peerId, sdp: entry.pc.localDescription });
            } catch { /* le prochain sync reprendra la négociation */ }
        })();
    }

    function syncPresence() {
        const channel = channelRef.current;
        const me = userIdRef.current;
        if (!channel || !me) return;
        const current = phaseRef.current;
        if (current === "idle" || current === "ended") return;
        const present = new Map<string, PresenceMeta>();
        const state = channel.presenceState<PresenceMeta>();
        for (const entries of Object.values(state)) {
            for (const entry of entries) {
                if (entry.userId && entry.userId !== me) present.set(entry.userId, entry);
            }
        }
        if (present.size > 0) sawPresenceRef.current = true;
        if (current === "incoming") {
            if (sawPresenceRef.current && present.size === 0) {
                pendingInviteRef.current = null;
                finishRef.current("ended");
            }
            return;
        }
        if (current === "outgoing" && present.size > 0) {
            clearRingTimeout();
            stopTone();
            goPhase("connecting");
            startWatchdog();
        }
        for (const [id, meta] of present) {
            presenceMetaRef.current.set(id, meta);
            touchTile(id, meta);
            if (me > id) negotiate(id);
        }
        for (const id of [...pcsRef.current.keys()]) {
            if (present.has(id)) continue;
            dropPeer(id);
            afterPeerGone();
        }
    }

    function handleOffer(payload: unknown) {
        const data = payload as { from?: string; to?: string; sdp?: RTCSessionDescriptionInit } | null;
        const peerId = data?.from;
        if (!peerId || !data?.sdp || (data.to && data.to !== userIdRef.current)) return;
        if (phaseRef.current !== "connecting" && phaseRef.current !== "active") return;
        void (async () => {
            try {
                const entry = createPeer(peerId);
                const pc = entry.pc;
                // Les deux côtés ont offert en même temps : le « poli » annule la sienne.
                if (pc.signalingState === "have-local-offer") {
                    if ((userIdRef.current ?? "") > peerId) return;
                    await pc.setLocalDescription({ type: "rollback" });
                } else if (pc.signalingState !== "stable") {
                    return;
                }
                await pc.setRemoteDescription(data.sdp!);
                entry.remoteSet = true;
                flushIce(entry);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                sendRoom("answer", { from: userIdRef.current, to: peerId, sdp: pc.localDescription });
            } catch { /* l'offre sera renvoyée au prochain sync */ }
        })();
    }

    function handleAnswer(payload: unknown) {
        const data = payload as { from?: string; to?: string; sdp?: RTCSessionDescriptionInit } | null;
        const peerId = data?.from;
        if (!peerId || !data?.sdp || (data.to && data.to !== userIdRef.current)) return;
        const entry = pcsRef.current.get(peerId);
        if (!entry || entry.pc.signalingState !== "have-local-offer") return;
        void (async () => {
            try {
                await entry.pc.setRemoteDescription(data.sdp!);
                entry.remoteSet = true;
                flushIce(entry);
            } catch { /* candidate ignorée */ }
        })();
    }

    function handleIce(payload: unknown) {
        const data = payload as { from?: string; to?: string; candidate?: RTCIceCandidateInit } | null;
        if (!data?.from || !data.candidate || (data.to && data.to !== userIdRef.current)) return;
        queueIce(data.from, data.candidate);
    }

    function handleReject(payload: unknown) {
        const data = payload as { from?: string; reason?: string } | null;
        const peerId = data?.from;
        if (phaseRef.current !== "outgoing" && phaseRef.current !== "connecting") return;
        const reason: CallEndReason = data?.reason === "busy" ? "busy"
            : data?.reason === "failed" ? "failed"
                : data?.reason === "noAnswer" ? "noAnswer"
                    : "declined";
        if (peerId) {
            declineTile(peerId);
            declinedRef.current.add(peerId);
        }
        const total = targetsRef.current.length;
        if (!isGroupRef.current || (total > 0 && declinedRef.current.size >= total)) {
            if (isCallerRef.current) dbOwnParticipant("left");
            finishRef.current(reason);
        }
    }

    function declineTile(peerId: string) {
        dropPeer(peerId);
        upsertTile(peerId, { connection: "declined", stream: null, cameraOn: false, muted: true });
    }

    function handleBye(payload: unknown) {
        const data = payload as { from?: string } | null;
        if (phaseRef.current === "idle" || phaseRef.current === "ended") return;
        if (data?.from) dropPeer(data.from);
        if (phaseRef.current === "incoming") {
            pendingInviteRef.current = null;
            finishRef.current("ended");
            return;
        }
        if (phaseRef.current === "outgoing") return;
        afterPeerGone();
    }

    function handleMedia(payload: unknown) {
        const data = payload as { from?: string; camera?: boolean; muted?: boolean } | null;
        if (!data?.from) return;
        const patch: Partial<CallTile> = {};
        if (typeof data.camera === "boolean") patch.cameraOn = data.camera;
        if (typeof data.muted === "boolean") patch.muted = data.muted;
        if (Object.keys(patch).length > 0) upsertTile(data.from, patch);
    }

    const handlersRef = useRef({
        offer: (_payload: unknown) => {},
        answer: (_payload: unknown) => {},
        ice: (_payload: unknown) => {},
        reject: (_payload: unknown) => {},
        bye: (_payload: unknown) => {},
        media: (_payload: unknown) => {},
        sync: () => {}
    });
    handlersRef.current = { offer: handleOffer, answer: handleAnswer, ice: handleIce, reject: handleReject, bye: handleBye, media: handleMedia, sync: syncPresence };

    // Salle d'appel : diffusion ciblée (offres, réponses, ICE, refus, départ) + présence,
    // qui sert de source de vérité pour « qui est réellement dans l'appel ».
    const joinCallRoom = useCallback(async (callId: string): Promise<RealtimeChannel | null> => {
        if (!supabase || !userIdRef.current) return null;
        const channel = supabase.channel(`call-${callId}`, { config: { broadcast: { self: false }, presence: { key: userIdRef.current } } });
        channel
            .on("broadcast", { event: "offer" }, ({ payload }) => handlersRef.current.offer(payload))
            .on("broadcast", { event: "answer" }, ({ payload }) => handlersRef.current.answer(payload))
            .on("broadcast", { event: "ice" }, ({ payload }) => handlersRef.current.ice(payload))
            .on("broadcast", { event: "reject" }, ({ payload }) => handlersRef.current.reject(payload))
            .on("broadcast", { event: "bye" }, ({ payload }) => handlersRef.current.bye(payload))
            .on("broadcast", { event: "media" }, ({ payload }) => handlersRef.current.media(payload))
            .on("presence", { event: "sync" }, () => handlersRef.current.sync());
        const subscribed = await new Promise<boolean>(resolve => {
            const timer = window.setTimeout(() => resolve(false), ROOM_TIMEOUT_MS);
            channel.subscribe(status => {
                if (status === "SUBSCRIBED") {
                    window.clearTimeout(timer);
                    resolve(true);
                } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    window.clearTimeout(timer);
                    resolve(false);
                }
            });
        });
        if (!subscribed) {
            void supabase.removeChannel(channel);
            return null;
        }
        return channel;
    }, [supabase]);

    // Refus express (occupé / bloqué) : on rejoint brièvement la salle juste pour prévenir
    // l'appelant, sans toucher à l'appel en cours s'il y en a un.
    const sendToCallRoom = useCallback(async (callId: string, event: string, payload?: unknown) => {
        if (!supabase) return;
        const room = supabase.channel(`call-${callId}`, { config: { broadcast: { self: false } } });
        room.subscribe(status => {
            if (status !== "SUBSCRIBED") return;
            void room.send({ type: "broadcast", event, payload });
            window.setTimeout(() => { void supabase.removeChannel(room); }, 1500);
        });
    }, [supabase]);

    const sendRingInvite = useCallback(async (callId: string, targetConversationId: string | null, callKind: CallKind, callTitle: string, group: boolean, members: CallPeer[], targetId: string) => {
        if (!supabase) return;
        const ring = supabase.channel(`ring-${targetId}`, { config: { broadcast: { self: false } } });
        ring.subscribe(status => {
            if (status !== "SUBSCRIBED") return;
            void ring.send({
                type: "broadcast",
                event: "invite",
                payload: {
                    callId,
                    conversationId: targetConversationId,
                    kind: callKind,
                    title: callTitle,
                    isGroup: group,
                    caller: { id: userIdRef.current, name: selfRef.current.name, avatar: selfRef.current.avatar ?? null },
                    members
                }
            });
            window.setTimeout(() => { void supabase.removeChannel(ring); }, 1500);
        });
    }, [supabase]);

    const startCall = useCallback(async ({ conversationId: targetConversationId, title: callTitle, kind: callKind, targets, isGroup: group }: StartCallOptions) => {
        if (!supabase || !userIdRef.current) return;
        if (phaseRef.current !== "idle" && phaseRef.current !== "ended") return;
        if (targets.length === 0) return;
        if (idleTimerRef.current !== null) { window.clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
        const callId = crypto.randomUUID();
        callIdRef.current = callId;
        isCallerRef.current = true;
        answeredRef.current = false;
        sawPresenceRef.current = false;
        declinedRef.current = new Set();
        targetsRef.current = targets;
        isGroupRef.current = group;
        kindRef.current = callKind;
        setKind(callKind);
        setTitle(callTitle);
        setIsGroup(group);
        setConversationId(targetConversationId);
        setParticipants(targets.map(target => ({ id: target.id, name: target.name, avatar: target.avatar ?? null, connection: "ringing" as CallConnection, stream: null, cameraOn: false, muted: false })));
        setEndReason(null);
        setStartedAt(null);
        setMuted(false);
        mutedRef.current = false;
        setCameraOn(false);
        cameraOnRef.current = false;
        setVideoFailed(false);
        goPhase("outgoing");
        const stream = await ensureMedia(callKind);
        if (!stream) {
            dbOwnParticipant("left");
            finishRef.current("failed");
            return;
        }
        channelRef.current = await joinCallRoom(callId);
        if (!channelRef.current) {
            dbOwnParticipant("left");
            finishRef.current("failed");
            return;
        }
        trackPresence();
        dbCreateCall(callId, targetConversationId, callKind, targets);
        const members: CallPeer[] = [{ id: userIdRef.current, name: selfRef.current.name, avatar: selfRef.current.avatar ?? null }, ...targets];
        for (const target of targets) void sendRingInvite(callId, targetConversationId, callKind, callTitle, group, members, target.id);
        startTone(440, 1000, 2000, 0.05);
        clearRingTimeout();
        ringTimeoutRef.current = window.setTimeout(() => {
            ringTimeoutRef.current = null;
            if (phaseRef.current !== "outgoing") return;
            sendRoom("bye", { from: userIdRef.current });
            dbOwnParticipant("left");
            finishRef.current("noAnswer");
        }, RING_TIMEOUT_MS);
    }, [supabase, joinCallRoom, sendRingInvite]);

    const acceptCall = useCallback(async () => {
        const invite = pendingInviteRef.current;
        if (!invite || phaseRef.current !== "incoming") return;
        pendingInviteRef.current = null;
        clearRingTimeout();
        stopTone();
        goPhase("connecting");
        startWatchdog();
        const stream = await ensureMedia(kindRef.current);
        if (!stream) {
            dbOwnParticipant("left");
            finishRef.current("failed");
            return;
        }
        trackPresence();
        handlersRef.current.sync();
        onAcceptedRef.current?.(invite.conversationId);
    }, []);

    const rejectCall = useCallback(async () => {
        pendingInviteRef.current = null;
        const me = userIdRef.current;
        dbOwnParticipant("declined");
        if (channelRef.current) {
            await channelRef.current.send({ type: "broadcast", event: "reject", payload: { from: me, reason: "declined" } });
        } else if (callIdRef.current) {
            void sendToCallRoom(callIdRef.current, "reject", { from: me, reason: "declined" });
        }
        finishRef.current("declined");
    }, [sendToCallRoom]);

    const hangUp = useCallback(() => {
        const current = phaseRef.current;
        if (current === "incoming") { void rejectCall(); return; }
        if (current === "idle" || current === "ended") return;
        dbOwnParticipant("left");
        sendRoom("bye", { from: userIdRef.current });
        finishRef.current("ended");
    }, [rejectCall]);

    const toggleMute = useCallback(() => {
        const stream = localStreamRef.current;
        if (!stream) return;
        const next = !mutedRef.current;
        mutedRef.current = next;
        for (const track of stream.getAudioTracks()) track.enabled = !next;
        setMuted(next);
        sendRoom("media", { from: userIdRef.current, camera: cameraOnRef.current, muted: next });
    }, []);

    const toggleCamera = useCallback(() => {
        const stream = localStreamRef.current;
        const track = stream?.getVideoTracks()[0];
        if (!track) return;
        track.enabled = !track.enabled;
        cameraOnRef.current = track.enabled;
        setCameraOn(track.enabled);
        sendRoom("media", { from: userIdRef.current, camera: track.enabled, muted: mutedRef.current });
    }, []);

    const handleInvite = useCallback(async (payload: unknown) => {
        if (!supabase || !userIdRef.current) return;
        const data = payload as InvitePayload | null;
        const callerId = data?.caller?.id;
        if (!data?.callId || !callerId || callerId === userIdRef.current) return;
        if (blockedRef.current.has(callerId)) {
            void sendToCallRoom(data.callId, "reject", { from: userIdRef.current, reason: "declined" });
            return;
        }
        if (phaseRef.current !== "idle" && phaseRef.current !== "ended") {
            void sendToCallRoom(data.callId, "reject", { from: userIdRef.current, reason: "busy" });
            return;
        }
        if (idleTimerRef.current !== null) { window.clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
        const callKind: CallKind = data.kind === "video" ? "video" : "audio";
        const caller: CallPeer = { id: callerId, name: data.caller?.name ?? "", avatar: data.caller?.avatar ?? null };
        const members = Array.isArray(data.members) && data.members.length > 0 ? data.members : [caller];
        callIdRef.current = data.callId;
        isCallerRef.current = false;
        answeredRef.current = false;
        sawPresenceRef.current = false;
        declinedRef.current = new Set();
        isGroupRef.current = Boolean(data.isGroup);
        kindRef.current = callKind;
        setKind(callKind);
        setTitle(data.title || caller.name);
        setIsGroup(Boolean(data.isGroup));
        setConversationId(data.conversationId ?? null);
        setParticipants(members
            .filter(member => member.id !== userIdRef.current)
            .map(member => ({ id: member.id, name: member.name, avatar: member.avatar ?? null, connection: "ringing" as CallConnection, stream: null, cameraOn: false, muted: false })));
        setEndReason(null);
        setStartedAt(null);
        setMuted(false);
        mutedRef.current = false;
        setCameraOn(false);
        cameraOnRef.current = false;
        setVideoFailed(false);
        pendingInviteRef.current = { callId: data.callId, conversationId: data.conversationId ?? null };
        channelRef.current = await joinCallRoom(data.callId);
        if (!channelRef.current) return;
        if (phaseRef.current !== "idle" && phaseRef.current !== "ended") return;
        goPhase("incoming");
        startTone(520, 400, 200, 0.1);
        clearRingTimeout();
        ringTimeoutRef.current = window.setTimeout(() => {
            ringTimeoutRef.current = null;
            if (phaseRef.current !== "incoming") return;
            pendingInviteRef.current = null;
            dbOwnParticipant("missed");
            sendRoom("reject", { from: userIdRef.current, reason: "noAnswer" });
            finishRef.current("noAnswer");
        }, RING_TIMEOUT_MS);
    }, [supabase, joinCallRoom, sendToCallRoom]);

    const handleInviteRef = useRef(handleInvite);
    handleInviteRef.current = handleInvite;

    // Canal personnel : c'est ici qu'arrivent les sonneries des autres utilisateurs.
    useEffect(() => {
        if (!supabase || !userId) return;
        const channel = supabase.channel(`ring-${userId}`, { config: { broadcast: { self: false } } })
            .on("broadcast", { event: "invite" }, ({ payload }) => { void handleInviteRef.current(payload); })
            .subscribe();
        return () => { void supabase.removeChannel(channel); };
    }, [supabase, userId]);

    useEffect(() => () => {
        cleanupRef.current();
        if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    }, []);

    return {
        phase,
        kind,
        title,
        isGroup,
        conversationId,
        participants,
        localStream,
        muted,
        cameraOn,
        videoFailed,
        startedAt,
        endReason,
        startCall,
        acceptCall,
        rejectCall,
        hangUp,
        toggleMute,
        toggleCamera
    };
}
