import { isRecentlyOnline } from "../../lib/format";

export type ConversationListItem = { id: string; name: string; preview: string; online?: boolean; avatar?: string; otherUserId?: string; unread?: number; otherLastSeen?: string | null };

type ConversationListProps = { items: ConversationListItem[]; selectedId: string; onSelect: (id: string) => void };

export function ConversationList({ items, selectedId, onSelect }: ConversationListProps) {
    return <div className="conversation-list">{items.map(item => <button key={item.id} className={`conversation ${item.id === selectedId ? "active" : ""}`} type="button" onClick={() => onSelect(item.id)}><img className="avatar" src={item.avatar || (item.id === "ai-gemini" ? "/images/gemini-avatar.svg" : "/images/default-avatar.svg")} alt="" />{isRecentlyOnline(item.online, item.otherLastSeen) && <span className="online-dot" />}<span className="conversation-copy"><span className="conversation-line"><span className="conversation-name">{item.name}</span></span><span className="conversation-preview">{item.preview}</span></span>{Boolean(item.unread) && <span className="unread-badge">{item.unread! > 99 ? "99+" : item.unread}</span>}</button>)}</div>;
}
