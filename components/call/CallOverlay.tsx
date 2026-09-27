"use client";

import { useEffect, useRef, useState } from "react";
import type { CallEndReason, CallPeer, CallPhase } from "../../lib/useVoiceCall";

export type CallLabels = {
    calling: string;
    ringing: string;
    connecting: string;
    inCall: string;
    declined: string;
    busy: string;
    noAnswer: string;
    ended: string;
    failed: string;
    answer: string;
    decline: string;
    hangUp: string;
    mute: string;
    unmute: string;
};

type CallOverlayProps = {
    phase: CallPhase;
    peer: CallPeer | null;
    endReason: CallEndReason;
    muted: boolean;
    startedAt: number | null;
    remoteStream: MediaStream | null;
    labels: CallLabels;
    onAccept: () => void;
    onReject: () => void;
    onHangUp: () => void;
    onToggleMute: () => void;
};

function formatDuration(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function CallOverlay({ phase, peer, endReason, muted, startedAt, remoteStream, labels, onAccept, onReject, onHangUp, onToggleMute }: CallOverlayProps) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (phase !== "active") return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [phase]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !remoteStream) return;
        audio.srcObject = remoteStream;
        void audio.play().catch(() => {});
    }, [remoteStream]);

    const status = phase === "outgoing"
        ? labels.calling
        : phase === "incoming"
            ? labels.ringing
            : phase === "connecting"
                ? labels.connecting
                : phase === "active"
                    ? labels.inCall
                    : endReason === "declined" ? labels.declined
                        : endReason === "busy" ? labels.busy
                            : endReason === "noAnswer" ? labels.noAnswer
                                : endReason === "failed" ? labels.failed
                                    : labels.ended;
    const duration = phase === "active" && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : null;

    return <div className="call-overlay">
        <audio ref={audioRef} autoPlay playsInline />
        <div className="call-card">
            <img className="call-avatar" src={peer?.avatar || "/images/default-avatar.svg"} alt="" />
            <h3>{peer?.name || "…"}</h3>
            <p className="call-status">{status}</p>
            {duration !== null && <p className="call-timer">{formatDuration(duration)}</p>}
            <div className="call-actions">
                {phase === "incoming"
                    ? <>
                        <button className="call-btn reject" type="button" aria-label={labels.decline} title={labels.decline} onClick={onReject}>✕</button>
                        <button className="call-btn accept" type="button" aria-label={labels.answer} title={labels.answer} onClick={onAccept}>📞</button>
                    </>
                    : phase !== "ended"
                        ? <>
                            <button className={`call-btn mute ${muted ? "muted" : ""}`} type="button" aria-label={muted ? labels.unmute : labels.mute} title={muted ? labels.unmute : labels.mute} onClick={onToggleMute}>{muted ? "🔇" : "🎙"}</button>
                            <button className="call-btn reject" type="button" aria-label={labels.hangUp} title={labels.hangUp} onClick={onHangUp}>✕</button>
                        </>
                        : null}
            </div>
        </div>
    </div>;
}
