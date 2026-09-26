export type ConversationListItem = { id: string; name: string; preview: string; online?: boolean; avatar?: string };

type ConversationListProps = { items: ConversationListItem[]; selectedId: string; onSelect: (id: string) => void };

export function ConversationList({ items, selectedId, onSelect }: ConversationListProps) {
    return <div className="conversation-list">{items.map(item => <button key={item.id} className={`conversation ${item.id === selectedId ? "active" : ""}`} type="button" onClick={() => onSelect(item.id)}><img className="avatar" src={item.avatar || (item.id === "ai-gemini" ? "/images/gemini-avatar.svg" : "/images/default-avatar.svg")} alt="" />{item.online && <span className="online-dot" />}<span className="conversation-copy"><span className="conversation-line"><span className="conversation-name">{item.name}</span></span><span className="conversation-preview">{item.preview}</span></span></button>)}</div>;
}
