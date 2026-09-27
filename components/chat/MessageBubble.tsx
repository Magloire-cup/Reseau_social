"use client";

import { useEffect, useRef, useState } from "react";

type MessageBubbleProps = {
    content: string;
    outgoing?: boolean;
    createdAt: string;
    status?: "sent" | "delivered" | "read";
    isAudio?: boolean;
    audioUrl?: string | null;
    audioPath?: string | null;
    onResignAudio?: (path: string) => Promise<string | null>;
    audioFallback?: string;
};

export function MessageBubble({ content, outgoing = false, createdAt, status, isAudio = false, audioUrl, audioPath, onResignAudio, audioFallback }: MessageBubbleProps) {
    const time = new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const [src, setSrc] = useState(audioUrl || "");
    const [failed, setFailed] = useState(false);
    const attemptsRef = useRef(0);

    useEffect(() => {
        if (!audioUrl) return;
        attemptsRef.current = 0;
        setFailed(false);
        setSrc(audioUrl);
    }, [audioUrl]);

    // Aucune URL exploitable (signature échouée au chargement) : on en demande une une fois.
    useEffect(() => {
        if (audioUrl || !audioPath || !onResignAudio || attemptsRef.current >= 1) return;
        attemptsRef.current += 1;
        onResignAudio(audioPath)
            .then(fresh => { if (fresh) setSrc(fresh); else setFailed(true); })
            .catch(() => setFailed(true));
    }, [audioUrl, audioPath, onResignAudio]);

    // URL signée expirée ou invalide : on en redemande une une fois, sinon repli visible.
    async function handleAudioError() {
        if (attemptsRef.current >= 1 || !audioPath || !onResignAudio) { setFailed(true); return; }
        attemptsRef.current += 1;
        const fresh = await onResignAudio(audioPath).catch(() => null);
        if (fresh) setSrc(fresh);
        else setFailed(true);
    }

    return <div className={`message-row ${outgoing ? "outgoing" : ""}`}><div className={`bubble${isAudio ? " audio" : ""}`}>
        {isAudio
            ? src && !failed
                ? <audio className="voice-note" controls preload="metadata" src={src} onError={handleAudioError} />
                : <span className="voice-unavailable">{audioFallback}</span>
            : content}
        <span className="message-meta">{time}{outgoing && <span className={`ticks${status === "read" ? " read" : ""}`}>{status === "read" ? "✓✓" : "✓"}</span>}</span>
    </div></div>;
}
