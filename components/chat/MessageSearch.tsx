"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageDialog } from "./MessageToolsDialog";
import type { MessageToolsLabels, TextMessageRow } from "./messageToolsCopy";

type Cursor = { createdAt: string; id: string };

export function MessageSearch({ conversationId, selfId, names, labels, onClose }: {
    conversationId: string;
    selfId: string;
    names: Record<string, string>;
    labels: MessageToolsLabels;
    onClose: () => void;
}) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<TextMessageRow[]>([]);
    const [cursor, setCursor] = useState<Cursor | null>(null);
    const [busy, setBusy] = useState(false);
    const [searched, setSearched] = useState(false);
    const [error, setError] = useState("");
    const [copyStatus, setCopyStatus] = useState("");
    const requestRef = useRef<AbortController | null>(null);
    const needle = query.trim();

    const load = useCallback(async (text: string, next: Cursor | null, controller: AbortController) => {
        setBusy(true);
        setError("");
        try {
            const params = new URLSearchParams({ conversationId, q: text });
            if (next) { params.set("beforeCreatedAt", next.createdAt); params.set("beforeId", next.id); }
            const response = await fetch(`/api/messages?${params}`, { signal: controller.signal });
            if (!response.ok) throw new Error("search");
            const payload = await response.json() as { messages: TextMessageRow[]; nextCursor: Cursor | null };
            if (controller.signal.aborted) return;
            setResults(current => next ? [...new Map([...current, ...payload.messages].map(message => [message.id, message])).values()] : payload.messages);
            setCursor(payload.nextCursor);
            setSearched(true);
        } catch {
            if (!controller.signal.aborted) setError(labels.searchFailed);
        } finally {
            if (!controller.signal.aborted) setBusy(false);
        }
    }, [conversationId, labels.searchFailed]);

    useEffect(() => {
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setResults([]);
        setCursor(null);
        setSearched(false);
        setError("");
        setCopyStatus("");
        setBusy(Boolean(needle));
        const timer = needle ? window.setTimeout(() => { void load(needle, null, controller); }, 300) : null;
        return () => { controller.abort(); requestRef.current?.abort(); if (timer !== null) window.clearTimeout(timer); };
    }, [needle, load]);

    async function copyText(content: string) {
        try { await navigator.clipboard.writeText(content); setCopyStatus(labels.copied); }
        catch { setCopyStatus(labels.copyFailed); }
    }

    function nextPage() {
        if (busy || !cursor) return;
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        void load(needle, cursor, controller);
    }

    return <MessageDialog title={labels.search} closeLabel={labels.close} onClose={onClose}>
        <p className="message-tool-hint">{labels.searchHint}</p>
        <input className="modal-input message-search-input" type="search" autoFocus aria-label={labels.searchPlaceholder} placeholder={labels.searchPlaceholder} maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="message-search-results" aria-busy={busy}>
            {results.map(message => <article key={message.id}>
                <header><strong>{message.sender_id === selfId ? labels.you : message.sender_id ? names[message.sender_id] || labels.member : labels.member}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time></header>
                <p>{message.content}</p>
                <button className="icon-button" type="button" onClick={() => void copyText(message.content)}>{labels.copy}</button>
            </article>)}
        </div>
        <p role="status" className="message-tool-hint">{busy ? labels.loading : searched && !results.length ? labels.searchEmpty : copyStatus}</p>
        {error && <p className="error" role="alert">{error}</p>}
        {cursor && <button className="primary" type="button" disabled={busy} onClick={nextPage}>{labels.more}</button>}
    </MessageDialog>;
}
