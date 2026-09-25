type MessageBubbleProps = {
    content: string;
    outgoing?: boolean;
    createdAt: string;
    status?: "sent" | "delivered" | "read";
};

export function MessageBubble({ content, outgoing = false, createdAt, status }: MessageBubbleProps) {
    return <div className={`message-row ${outgoing ? "outgoing" : ""}`}><div className="bubble">{content}<span className="message-meta">{new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{outgoing ? ` ${status === "read" ? "✓✓" : "✓"}` : ""}</span></div></div>;
}
