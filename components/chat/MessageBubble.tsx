"use client";

import { TouchEvent, useEffect, useRef, useState } from "react";

export type ReplyPreview = { name?: string; content: string; isAudio: boolean };

type MessageBubbleProps = {
    messageId: string;
    content: string;
    outgoing?: boolean;
    createdAt: string;
    status?: "sent" | "delivered" | "read";
    isAudio?: boolean;
    audioUrl?: string | null;
    audioPath?: string | null;
    onResignAudio?: (path: string) => Promise<string | null>;
    audioFallback?: string;
    senderName?: string;
    replyId?: string | null;
    replyTo?: ReplyPreview | null;
    highlight?: boolean;
    canReply?: boolean;
    onReply?: () => void;
    onQuoteClick?: (messageId: string) => void;
    labels?: { reply: string; unavailable: string; voice: string };
};

// Geste « glisser pour répondre » : horizontal franc, sans gêner le défilement vertical.
const SWIPE_TRIGGER = 60;
const SWIPE_MAX_VERTICAL = 48;

export function MessageBubble({ messageId, content, outgoing = false, createdAt, status, isAudio = false, audioUrl, audioPath, onResignAudio, audioFallback, senderName, replyId = null, replyTo = null, highlight = false, canReply = false, onReply, onQuoteClick, labels }: MessageBubbleProps) {
    const time = new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const [src, setSrc] = useState(audioUrl || "");
    const [failed, setFailed] = useState(false);
    const attemptsRef = useRef(0);
    const touchRef = useRef<{ x: number; y: number } | null>(null);

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

    function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
        const target = event.target as HTMLElement;
        if (target.closest("audio") || !canReply || !onReply) return;
        const touch = event.touches[0];
        touchRef.current = { x: touch.clientX, y: touch.clientY };
    }

    function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
        const start = touchRef.current;
        touchRef.current = null;
        if (!start || !canReply || !onReply) return;
        const touch = event.changedTouches[0];
        if (touch.clientX - start.x > SWIPE_TRIGGER && Math.abs(touch.clientY - start.y) < SWIPE_MAX_VERTICAL) onReply();
    }

    const quoteText = replyTo ? (replyTo.isAudio ? labels?.voice ?? "" : replyTo.content) : labels?.unavailable ?? "";

    return <div id={`message-${messageId}`} className={`message-row ${outgoing ? "outgoing" : ""} ${highlight ? "highlight" : ""}`.trim()} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {canReply && onReply && <button className="bubble-reply" type="button" aria-label={labels?.reply} title={labels?.reply} onClick={onReply}>↩</button>}
        <div className={`bubble${isAudio ? " audio" : ""}`}>
            {senderName && <span className="bubble-sender">{senderName}</span>}
            {replyId && <button className="bubble-quote" type="button" onClick={() => onQuoteClick?.(replyId)}>
                {replyTo?.name && <span className="bubble-quote-name">{replyTo.name}</span>}
                <span className="bubble-quote-text">{quoteText}</span>
            </button>}
            {isAudio
                ? src && !failed
                    ? <audio className="voice-note" controls preload="metadata" src={src} onError={handleAudioError} />
                    : <span className="voice-unavailable">{audioFallback}</span>
                : content}
            <span className="message-meta">{time}{outgoing && <span className={`ticks${status === "read" ? " read" : ""}`}>{status === "read" ? "✓✓" : "✓"}</span>}</span>
        </div>
    </div>;
}
