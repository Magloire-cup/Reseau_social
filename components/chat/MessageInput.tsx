import { FormEvent, useState } from "react";

type MessageInputProps = { placeholder: string; disabled?: boolean; onSend: (content: string) => Promise<void> | void };

export function MessageInput({ placeholder, disabled = false, onSend }: MessageInputProps) {
    const [value, setValue] = useState("");
    async function submit(event: FormEvent) { event.preventDefault(); const content = value.trim(); if (!content) return; await onSend(content); setValue(""); }
    return <form className="composer" onSubmit={submit}><input value={value} onChange={event => setValue(event.target.value)} placeholder={placeholder} disabled={disabled} /><button className="send" type="submit" aria-label="Send message">➤</button></form>;
}
