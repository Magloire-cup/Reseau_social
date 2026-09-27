import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export type CallPeer = { id: string; name: string; avatar?: string | null };
export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";
export type CallEndReason = "declined" | "busy" | "noAnswer" | "ended" | "failed" | null;

const RING_TIMEOUT_MS = 40000;
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type InvitePayload = { callId?: string; conversationId?: string | null; caller?: { id?: string; name?: string; avatar?: string | null } };

export function useVoiceCall({ supabase, userId, self, blockedIds, onAccepted }: {
    supabase: SupabaseClient | null;
    userId: string | null;
    self: { name: string; avatar?: string | null };
    blockedIds: Set<string>;
    onAccepted?: (conversationId: string | null) => void;
}) {
    const [phase, setPhase] = useState<CallPhase>("idle");
    const [peer, setPeer] = useState<CallPeer | null>(null);
    const [muted, setMuted] = useState(false);
    const [startedAt, setStartedAt] = useState<number | null>(null);
    const [endReason, setEndReason] = useState<CallEndReason>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

    const phaseRef = useRef<CallPhase>("idle");
    const userIdRef = useRef(userId);
    userIdRef.current = userId;
    const selfRef = useRef(self);
    selfRef.current = self;
    const blockedRef = useRef(blockedIds);
    blockedRef.current = blockedIds;
    const onAcceptedRef = useRef(onAccepted);
    onAcceptedRef.current = onAccepted;

    const pcRef = useRef<RTCPeerConnection | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const channelRef = useRef<RealtimeChannel | null>(null);
    const ringTimeoutRef = useRef<number | null>(null);
    const idleTimerRef = useRef<number | null>(null);
    const toneStopRef = useRef<(() => void) | null>(null);
    const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
    const remoteReadyRef = useRef(false);
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

    async function ensureMedia(): Promise<MediaStream> {
        if (localStreamRef.current) return localStreamRef.current;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        return stream;
    }

    function flushIce() {
        const pc = pcRef.current;
        for (const candidate of pendingIceRef.current.splice(0)) {
            if (pc) void pc.addIceCandidate(candidate).catch(() => {});
        }
    }

    function createPc(): RTCPeerConnection {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;
        pc.onicecandidate = event => {
            if (event.candidate && channelRef.current) {
                void channelRef.current.send({ type: "broadcast", event: "ice", payload: { candidate: event.candidate.toJSON() } });
            }
        };
        pc.ontrack = event => {
            setRemoteStream(event.streams[0] ?? new MediaStream([event.track]));
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "connected") {
                if (phaseRef.current === "outgoing" || phaseRef.current === "connecting") {
                    clearRingTimeout();
                    stopTone();
                    setStartedAt(Date.now());
                    goPhase("active");
                }
            } else if (pc.connectionState === "failed") {
                finishRef.current("failed");
            }
        };
        return pc;
    }

    const cleanup = useCallback(() => {
        stopTone();
        clearRingTimeout();
        if (pcRef.current) {
            try { pcRef.current.close(); } catch { /* déjà fermé */ }
            pcRef.current = null;
        }
        if (localStreamRef.current) {
            for (const track of localStreamRef.current.getTracks()) track.stop();
            localStreamRef.current = null;
        }
        if (channelRef.current && supabase) void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
        pendingIceRef.current = [];
        remoteReadyRef.current = false;
        setMuted(false);
        setRemoteStream(null);
    }, [supabase]);

    function finish(reason: CallEndReason) {
        cleanup();
        goPhase("ended");
        setEndReason(reason);
        if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = window.setTimeout(() => {
            idleTimerRef.current = null;
            setPhase(current => current === "ended" ? "idle" : current);
        }, 2500);
    }
    finishRef.current = finish;

    // Rejoint la salle d'appel (broadcast) et branche la négociation WebRTC.
    const joinCallRoom = useCallback(async (callId: string): Promise<RealtimeChannel | null> => {
        if (!supabase) return null;
        const channel = supabase.channel(`call-${callId}`, { config: { broadcast: { self: false } } });
        channel
            .on("broadcast", { event: "accept" }, () => {
                if (phaseRef.current !== "outgoing") return;
                goPhase("connecting");
                stopTone();
                void (async () => {
                    try {
                        const stream = await ensureMedia();
                        const pc = pcRef.current ?? createPc();
                        for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        await channel.send({ type: "broadcast", event: "offer", payload: { sdp: pc.localDescription } });
                    } catch {
                        void channel.send({ type: "broadcast", event: "reject", payload: { reason: "failed" } });
                        finishRef.current("failed");
                    }
                })();
            })
            .on("broadcast", { event: "offer" }, ({ payload }) => {
                if (phaseRef.current !== "connecting") return;
                void (async () => {
                    try {
                        const stream = await ensureMedia();
                        const pc = pcRef.current ?? createPc();
                        for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
                        const data = payload as { sdp?: RTCSessionDescriptionInit } | null;
                        if (!data?.sdp) return;
                        await pc.setRemoteDescription(data.sdp);
                        remoteReadyRef.current = true;
                        flushIce();
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        await channel.send({ type: "broadcast", event: "answer", payload: { sdp: pc.localDescription } });
                    } catch {
                        finishRef.current("failed");
                    }
                })();
            })
            .on("broadcast", { event: "answer" }, ({ payload }) => {
                if (phaseRef.current !== "connecting") return;
                void (async () => {
                    try {
                        const data = payload as { sdp?: RTCSessionDescriptionInit } | null;
                        if (!data?.sdp || !pcRef.current) return;
                        await pcRef.current.setRemoteDescription(data.sdp);
                        remoteReadyRef.current = true;
                        flushIce();
                    } catch {
                        finishRef.current("failed");
                    }
                })();
            })
            .on("broadcast", { event: "ice" }, ({ payload }) => {
                const data = payload as { candidate?: RTCIceCandidateInit } | null;
                if (!data?.candidate) return;
                if (pcRef.current && remoteReadyRef.current) void pcRef.current.addIceCandidate(data.candidate).catch(() => {});
                else pendingIceRef.current.push(data.candidate);
            })
            .on("broadcast", { event: "reject" }, ({ payload }) => {
                if (phaseRef.current !== "outgoing" && phaseRef.current !== "connecting") return;
                const data = payload as { reason?: string } | null;
                finishRef.current(data?.reason === "busy" ? "busy" : data?.reason === "failed" ? "failed" : "declined");
            })
            .on("broadcast", { event: "hangup" }, () => {
                if (phaseRef.current === "idle" || phaseRef.current === "ended") return;
                finishRef.current("ended");
            });
        await new Promise<void>(resolve => {
            channel.subscribe(status => { if (status === "SUBSCRIBED") resolve(); });
        });
        return channel;
    }, [supabase]);

    // Refus express (occupé / bloqué / sonnerie expirée) : on rejoint brièvement la salle
    // juste pour prévenir l'appelant, sans toucher à l'appel en cours s'il y en a un.
    const sendToCallRoom = useCallback(async (callId: string, event: string, payload?: unknown) => {
        if (!supabase) return;
        const room = supabase.channel(`call-${callId}`, { config: { broadcast: { self: false } } });
        room.subscribe(status => {
            if (status !== "SUBSCRIBED") return;
            void room.send({ type: "broadcast", event, payload });
            window.setTimeout(() => { void supabase.removeChannel(room); }, 1500);
        });
    }, [supabase]);

    const startCall = useCallback(async (target: CallPeer, conversationId: string | null) => {
        if (!supabase || !userIdRef.current) return;
        if (phaseRef.current !== "idle" && phaseRef.current !== "ended") return;
        if (idleTimerRef.current !== null) { window.clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
        const callId = crypto.randomUUID();
        callIdRef.current = callId;
        setPeer(target);
        setEndReason(null);
        setStartedAt(null);
        setMuted(false);
        goPhase("outgoing");
        channelRef.current = await joinCallRoom(callId);
        const ring = supabase.channel(`ring-${target.id}`, { config: { broadcast: { self: false } } });
        ring.subscribe(status => {
            if (status !== "SUBSCRIBED") return;
            void ring.send({ type: "broadcast", event: "invite", payload: { callId, conversationId, caller: { id: userIdRef.current, name: selfRef.current.name, avatar: selfRef.current.avatar ?? null } } });
            window.setTimeout(() => { void supabase.removeChannel(ring); }, 1500);
        });
        startTone(440, 1000, 2000, 0.05);
        clearRingTimeout();
        ringTimeoutRef.current = window.setTimeout(() => {
            if (phaseRef.current !== "outgoing") return;
            void channelRef.current?.send({ type: "broadcast", event: "hangup" });
            finishRef.current("noAnswer");
        }, RING_TIMEOUT_MS);
    }, [supabase, joinCallRoom]);

    const acceptCall = useCallback(async () => {
        const invite = pendingInviteRef.current;
        if (!invite || phaseRef.current !== "incoming") return;
        pendingInviteRef.current = null;
        clearRingTimeout();
        stopTone();
        goPhase("connecting");
        try {
            await ensureMedia();
        } catch {
            void channelRef.current?.send({ type: "broadcast", event: "reject", payload: { reason: "failed" } });
            finishRef.current("failed");
            return;
        }
        createPc();
        await channelRef.current?.send({ type: "broadcast", event: "accept" });
        onAcceptedRef.current?.(invite.conversationId);
    }, []);

    const rejectCall = useCallback(async () => {
        pendingInviteRef.current = null;
        if (channelRef.current) {
            await channelRef.current.send({ type: "broadcast", event: "reject", payload: { reason: "declined" } });
        }
        finishRef.current("declined");
    }, []);

    const hangUp = useCallback(() => {
        if (phaseRef.current === "incoming") { void rejectCall(); return; }
        const channel = channelRef.current;
        void (async () => {
            try { await channel?.send({ type: "broadcast", event: "hangup" }); } catch { /* canal déjà fermé */ }
            finishRef.current("ended");
        })();
    }, [rejectCall]);

    const toggleMute = useCallback(() => {
        const stream = localStreamRef.current;
        if (!stream) return;
        setMuted(current => {
            const next = !current;
            for (const track of stream.getAudioTracks()) track.enabled = !next;
            return next;
        });
    }, []);

    const handleInvite = useCallback(async (payload: unknown) => {
        if (!supabase) return;
        const data = payload as InvitePayload | null;
        const callerId = data?.caller?.id;
        if (!data?.callId || !callerId || callerId === userIdRef.current) return;
        if (blockedRef.current.has(callerId)) {
            void sendToCallRoom(data.callId, "reject", { reason: "declined" });
            return;
        }
        if (phaseRef.current !== "idle" && phaseRef.current !== "ended") {
            void sendToCallRoom(data.callId, "reject", { reason: "busy" });
            return;
        }
        if (idleTimerRef.current !== null) { window.clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
        const caller: CallPeer = { id: callerId, name: data.caller?.name ?? "", avatar: data.caller?.avatar ?? null };
        callIdRef.current = data.callId;
        pendingInviteRef.current = { callId: data.callId, conversationId: data.conversationId ?? null };
        setPeer(caller);
        setEndReason(null);
        setStartedAt(null);
        setMuted(false);
        channelRef.current = await joinCallRoom(data.callId);
        if (phaseRef.current !== "idle" && phaseRef.current !== "ended") return;
        goPhase("incoming");
        startTone(520, 400, 200, 0.1);
        clearRingTimeout();
        ringTimeoutRef.current = window.setTimeout(() => {
            if (phaseRef.current !== "incoming") return;
            pendingInviteRef.current = null;
            void channelRef.current?.send({ type: "broadcast", event: "reject", payload: { reason: "declined" } });
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
        cleanup();
        if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    }, [cleanup]);

    return { phase, peer, muted, startedAt, endReason, remoteStream, startCall, acceptCall, rejectCall, hangUp, toggleMute };
}
