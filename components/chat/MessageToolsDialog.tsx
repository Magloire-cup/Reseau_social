"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { MessageToolsLabels, TextMessageRow } from "./messageToolsCopy";

export function MessageDialog({ title, closeLabel, returnFocusId, onClose, children }: { title: string; closeLabel: string; returnFocusId?: string; onClose: () => void; children: ReactNode }) {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = ref.current;
        const trigger = returnFocusId
            ? document.getElementById(returnFocusId)?.querySelector<HTMLButtonElement>(".bubble-actions-toggle")
            : document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog?.showModal();
        return () => {
            dialog?.close();
            if (trigger?.isConnected && !dialog?.contains(trigger)) trigger.focus({ preventScroll: true });
        };
    }, [returnFocusId]);
    return <dialog ref={ref} className="message-dialog" aria-label={title} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="message-dialog-body">
            <header><h3>{title}</h3><button type="button" className="icon-button" aria-label={closeLabel} onClick={onClose}>×</button></header>
            {children}
        </div>
    </dialog>;
}

export function MessageToolsDialog({ mode, message, conversationId, destinations, labels, onClose, onSaved, onForwarded }: {
    mode: "edit" | "forward";
    message: { id: string; content: string };
    conversationId: string;
    destinations: { id: string; name: string }[];
    labels: MessageToolsLabels;
    onClose: () => void;
    onSaved: (message: TextMessageRow, previousContent: string) => void;
    onForwarded: () => void;
}) {
    const [content, setContent] = useState(message.content);
    const [destination, setDestination] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const submitting = useRef(false);
    const messageId = useRef(crypto.randomUUID());
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const editing = mode === "edit";

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (submitting.current || (editing ? !content.trim() || content.trim() === message.content : !destination)) return;
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
            const response = await fetch("/api/messages", {
                method: editing ? "PATCH" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(editing
                    ? { conversationId, messageId: message.id, content: content.trim(), previousContent: message.content }
                    : { conversationId: destination, messageId: messageId.current, forwardMessageId: message.id })
            });
            if (!response.ok) throw new Error(editing && response.status === 409 ? labels.conflict : editing ? labels.editFailed : labels.forwardFailed);
            const payload = await response.json() as { message: TextMessageRow };
            if (mounted.current) {
                if (editing) onSaved(payload.message, message.content);
                else onForwarded();
                onClose();
            }
        } catch (cause) {
            if (mounted.current) setError(cause instanceof Error && [labels.conflict, labels.editFailed, labels.forwardFailed].includes(cause.message) ? cause.message : editing ? labels.editFailed : labels.forwardFailed);
        } finally {
            submitting.current = false;
            if (mounted.current) setBusy(false);
        }
    }

    return <MessageDialog title={editing ? labels.edit : labels.forward} closeLabel={labels.close} returnFocusId={`message-${message.id}`} onClose={onClose}>
        <form onSubmit={submit} className="message-tool-form" aria-busy={busy}>
            {editing ? <label>{labels.editLabel}<textarea autoFocus maxLength={4000} rows={5} value={content} disabled={busy} onChange={event => setContent(event.target.value)} /></label>
                : <>
                    <p className="message-forward-preview">{message.content}</p>
                    <p className="message-tool-hint">{labels.forwardNote}</p>
                    <label>{labels.forwardTo}<select autoFocus value={destination} disabled={busy} onChange={event => { setDestination(event.target.value); messageId.current = crypto.randomUUID(); }} required>
                        <option value="">{labels.choose}</option>
                        {destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select></label>
                    {destinations.length === 0 && <p role="status">{labels.noDestination}</p>}
                </>}
            {error && <p className="error" role="alert">{error}</p>}
            <footer>
                <button className="icon-button" type="button" onClick={onClose}>{labels.cancel}</button>
                <button className="primary" type="submit" disabled={busy || (editing ? !content.trim() || content.trim() === message.content : !destination)}>{busy ? editing ? labels.saving : labels.forwarding : editing ? labels.save : labels.forward}</button>
            </footer>
        </form>
    </MessageDialog>;
}
