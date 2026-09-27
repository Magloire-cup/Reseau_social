"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

export type RecordingLabels = { record: string; stop: string; cancel: string; unavailable: string; failed: string };

type MessageInputProps = {
    placeholder: string;
    disabled?: boolean;
    allowAudio?: boolean;
    labels?: RecordingLabels;
    onSend: (content: string) => Promise<void> | void;
    onSendAudio?: (audio: Blob, mimeType: string, durationSeconds: number) => Promise<void> | void;
    onTyping?: () => void;
};

const MAX_SECONDS = 120;
// AAC/MP4 en premier : durée fiable dans le lecteur, lisible par Chrome, Edge, Safari et Firefox.
// WebM/Opus en secours (Firefox) puis Ogg.
const MIME_CANDIDATES = ["audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

function formatDuration(total: number) {
    const minutes = Math.floor(total / 60).toString().padStart(2, "0");
    const seconds = (total % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
}

function MicIcon() {
    return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z" /></svg>;
}

export function MessageInput({ placeholder, disabled = false, allowAudio = false, labels, onSend, onSendAudio, onTyping }: MessageInputProps) {
    const [value, setValue] = useState("");
    const [recording, setRecording] = useState(false);
    const [seconds, setSeconds] = useState(0);
    const [error, setError] = useState("");
    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const cancelRef = useRef(false);
    const secondsRef = useRef(0);
    const timerRef = useRef<number | null>(null);

    function stopTracks() {
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }

    function clearTimer() {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
    }

    function stopRecording(send: boolean) {
        cancelRef.current = !send;
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") { recorder.stop(); return; }
        clearTimer();
        stopTracks();
        setRecording(false);
        setSeconds(0);
    }

    useEffect(() => {
        if (disabled && recording) stopRecording(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [disabled, recording]);

    useEffect(() => () => {
        cancelRef.current = true;
        clearTimer();
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") recorder.stop();
        stopTracks();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function startRecording() {
        if (disabled || recording) return;
        setError("");
        const mimeType = typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia
            ? null
            : (MIME_CANDIDATES.find(candidate => MediaRecorder.isTypeSupported(candidate)) ?? "");
        if (mimeType === null) { setError(labels?.unavailable ?? "Recording is not available on this device."); return; }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            chunksRef.current = [];
            cancelRef.current = false;
            secondsRef.current = 0;
            recorder.ondataavailable = event => { if (event.data.size > 0) chunksRef.current.push(event.data); };
            recorder.onstop = () => {
                clearTimer();
                stopTracks();
                setRecording(false);
                setSeconds(0);
                const cancelled = cancelRef.current;
                const chunks = chunksRef.current;
                const elapsed = secondsRef.current;
                const type = (recorder.mimeType || mimeType || "audio/webm").split(";")[0];
                cancelRef.current = false;
                chunksRef.current = [];
                secondsRef.current = 0;
                recorderRef.current = null;
                if (cancelled || chunks.length === 0 || !onSendAudio) return;
                Promise.resolve(onSendAudio(new Blob(chunks, { type }), type, Math.min(MAX_SECONDS, Math.max(1, Math.round(elapsed))))).catch(() => setError(labels?.failed ?? "Could not send the voice message."));
            };
            recorder.start();
            recorderRef.current = recorder;
            setRecording(true);
            setSeconds(0);
            timerRef.current = window.setInterval(() => {
                secondsRef.current += 1;
                setSeconds(secondsRef.current);
                if (secondsRef.current >= MAX_SECONDS) stopRecording(true);
            }, 1000);
        } catch {
            stopTracks();
            setError(labels?.failed ?? "Microphone unavailable.");
        }
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        const content = value.trim();
        if (!content || disabled || recording) return;
        await onSend(content);
        setValue("");
    }

    return <form className={`composer${recording ? " recording" : ""}`} onSubmit={submit}>
        {recording ? <>
            <button className="icon-button" type="button" aria-label={labels?.cancel} onClick={() => stopRecording(false)}>✕</button>
            <span className="recording-status"><span className="rec-dot" />{formatDuration(seconds)}</span>
            <button className="send" type="button" aria-label={labels?.stop} onClick={() => stopRecording(true)}>➤</button>
        </> : <>
            <input value={value} onChange={event => { setValue(event.target.value); if (event.target.value.trim()) onTyping?.(); }} placeholder={placeholder} disabled={disabled} />
            {allowAudio && onSendAudio && <button className="icon-button mic-button" type="button" aria-label={labels?.record} disabled={disabled} onClick={startRecording}><MicIcon /></button>}
            <button className="send" type="submit" aria-label="Send message">➤</button>
        </>}
        {error && <span className="composer-error">{error}</span>}
    </form>;
}
