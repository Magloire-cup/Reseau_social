"use client";

import { useEffect, useRef, useState } from "react";
import type { CallEndReason, CallKind, CallPhase, CallTile } from "../../lib/useVoiceCall";

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
    cameraOn: string;
    cameraOff: string;
    camUnavailable: string;
    cameraOffShort: string;
    you: string;
    left: string;
    refused: string;
};

type CallOverlayProps = {
    phase: CallPhase;
    kind: CallKind;
    title: string;
    isGroup: boolean;
    participants: CallTile[];
    localStream: MediaStream | null;
    self: { name: string; avatar?: string | null };
    muted: boolean;
    cameraOn: boolean;
    videoFailed: boolean;
    startedAt: number | null;
    endReason: CallEndReason;
    labels: CallLabels;
    onAccept: () => void;
    onReject: () => void;
    onHangUp: () => void;
    onToggleMute: () => void;
    onToggleCamera: () => void;
};

function formatDuration(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted: boolean; className?: string }) {
    const ref = useRef<HTMLVideoElement | null>(null);
    useEffect(() => {
        const video = ref.current;
        if (!video) return;
        if (video.srcObject !== stream) video.srcObject = stream;
        if (stream) void video.play().catch(() => {});
    }, [stream]);
    return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function TileState({ tile, labels }: { tile: CallTile; labels: CallLabels }) {
    if (tile.connection === "ringing") return <span className="tile-state">{labels.ringing}</span>;
    if (tile.connection === "connecting") return <span className="tile-state">{labels.connecting}</span>;
    if (tile.connection === "left") return <span className="tile-state">{labels.left}</span>;
    if (tile.connection === "declined") return <span className="tile-state">{labels.refused}</span>;
    return null;
}

function RemoteTile({ tile, kind, labels }: { tile: CallTile; kind: CallKind; labels: CallLabels }) {
    const hasVideo = Boolean(tile.stream && tile.stream.getVideoTracks().length > 0);
    const showVideo = hasVideo && tile.cameraOn;
    return <div className={`call-tile ${tile.connection}`}>
        <StreamVideo stream={tile.stream} muted={false} className={`tile-video ${showVideo ? "" : "is-hidden"}`} />
        {!showVideo && <div className="tile-placeholder">
            <img className="tile-avatar" src={tile.avatar || "/images/default-avatar.svg"} alt="" />
        </div>}
        <span className="tile-name">{tile.name || "…"}{tile.muted ? " · 🔇" : ""}</span>
        {kind === "video" && !tile.cameraOn && tile.connection === "active" && <span className="tile-badge">{labels.cameraOffShort}</span>}
        <TileState tile={tile} labels={labels} />
    </div>;
}

export function CallOverlay({ phase, kind, title, isGroup, participants, localStream, self, muted, cameraOn, videoFailed, startedAt, endReason, labels, onAccept, onReject, onHangUp, onToggleMute, onToggleCamera }: CallOverlayProps) {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (phase !== "active") return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [phase]);

    const status = phase === "outgoing"
        ? labels.calling
        : phase === "incoming"
            ? (kind === "video" ? `${labels.ringing} · ${labels.cameraOffShort}` : labels.ringing)
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
    const grid = kind === "video" || isGroup || participants.length > 1;
    const localHasVideo = Boolean(localStream && localStream.getVideoTracks().length > 0);
    const peer = participants[0] ?? null;
    // En tête-à-tête le titre vient de l'appelant : on affiche le nom du correspondant
    // pour que chacun voie bien l'autre.
    const heading = !isGroup && peer ? peer.name : (title || "…");

    return <div className="call-overlay">
        <div className={`call-card ${grid ? "with-grid" : ""}`}>
            {grid
                ? <>
                    <div className="call-head">
                        <span className={`call-kind ${kind}`}>{kind === "video" ? "📹" : "📞"}</span>
                        <h3>{heading}</h3>
                    </div>
                    <div className="call-grid">
                        {(phase === "connecting" || phase === "active" || phase === "incoming") && <div className="call-tile self active">
                            <StreamVideo stream={localStream} muted className={`tile-video ${cameraOn && localHasVideo ? "" : "is-hidden"}`} />
                            {!(cameraOn && localHasVideo) && <div className="tile-placeholder">
                                <img className="tile-avatar" src={self.avatar || "/images/default-avatar.svg"} alt="" />
                            </div>}
                            <span className="tile-name">{labels.you}{muted ? " · 🔇" : ""}</span>
                        </div>}
                        {participants.map(tile => <RemoteTile key={tile.id} tile={tile} kind={kind} labels={labels} />)}
                    </div>
                </>
                : <>
                    <StreamVideo stream={peer?.stream ?? null} muted={false} className="peer-audio" />
                    <img className="call-avatar" src={peer?.avatar || "/images/default-avatar.svg"} alt="" />
                    <h3>{peer?.name || title || "…"}</h3>
                    <p className="call-status">{status}</p>
                </>}
            {grid && <p className="call-status under-grid">{status}</p>}
            {duration !== null && <p className="call-timer">{formatDuration(duration)}</p>}
            {videoFailed && <p className="call-notice">{labels.camUnavailable}</p>}
            <div className="call-actions">
                {phase === "incoming"
                    ? <>
                        <button className="call-btn reject" type="button" aria-label={labels.decline} title={labels.decline} onClick={onReject}>✕</button>
                        <button className="call-btn accept" type="button" aria-label={labels.answer} title={labels.answer} onClick={onAccept}>📞</button>
                    </>
                    : phase !== "ended"
                        ? <>
                            {kind === "video" && localHasVideo && <button className={`call-btn camera ${cameraOn ? "" : "muted"}`} type="button" aria-label={cameraOn ? labels.cameraOff : labels.cameraOn} title={cameraOn ? labels.cameraOff : labels.cameraOn} onClick={onToggleCamera}>{cameraOn ? "📹" : "🚫"}</button>}
                            <button className={`call-btn mute ${muted ? "muted" : ""}`} type="button" aria-label={muted ? labels.unmute : labels.mute} title={muted ? labels.unmute : labels.mute} onClick={onToggleMute}>{muted ? "🔇" : "🎙"}</button>
                            <button className="call-btn reject" type="button" aria-label={labels.hangUp} title={labels.hangUp} onClick={onHangUp}>✕</button>
                        </>
                        : null}
            </div>
        </div>
    </div>;
}
