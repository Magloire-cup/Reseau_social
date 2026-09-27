"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CallLogPeer = { id: string; name: string; avatar?: string | null };
export type CallLogOutcome = "answered" | "missed" | "declined" | "noAnswer" | "cancelled";
export type CallLogEntry = {
    id: string;
    conversationId: string;
    kind: "audio" | "video";
    direction: "outgoing" | "incoming";
    outcome: CallLogOutcome;
    title: string;
    avatar?: string | null;
    isGroup: boolean;
    createdAt: string;
    durationSeconds: number | null;
    targets: CallLogPeer[];
};

export type CallLogLabels = {
    empty: string;
    missed: string;
    declined: string;
    noAnswer: string;
    cancelled: string;
    answered: string;
    callBack: string;
    group: string;
    unknown: string;
};

type Person = { id: string; name: string | null; avatar: string | null };
type ParticipantRow = { user_id: string; status: string; users: Person | null };
type CallRow = {
    id: string;
    conversation_id: string;
    caller_id: string;
    kind: string;
    status: string;
    created_at: string;
    answered_at: string | null;
    duration_seconds: number | null;
    caller: Person | null;
    conversations: { name: string; type: string; conversation_members: { user_id: string; users: Person | null }[] | null } | null;
    call_participants: ParticipantRow[] | null;
};

// Un appel encore « en sonnerie » ou « actif » est affiché par la fenêtre d'appel ;
// il n'entre dans l'historique qu'une fois périmé (client disparu sans clore l'appel).
const LIVE_GRACE_MS = 3 * 60 * 1000;

function formatWhen(iso: string, language: "fr" | "en"): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const minutes = Math.round((Date.now() - then) / 60000);
    if (minutes < 1) return language === "fr" ? "à l'instant" : "just now";
    if (minutes < 60) return language === "fr" ? `il y a ${minutes} min` : `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return language === "fr" ? `il y a ${hours} h` : `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return language === "fr" ? `il y a ${days} j` : `${days} d ago`;
    return new Date(then).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short" });
}

function formatDuration(seconds: number, language: "fr" | "en"): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes === 0) return language === "fr" ? `${rest} s` : `${rest}s`;
    return language === "fr" ? `${minutes} min ${String(rest).padStart(2, "0")} s` : `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

export function CallLog({ supabase, userId, language, labels, refreshToken, onCall, onOpen }: {
    supabase: SupabaseClient | null;
    userId: string | null;
    language: "fr" | "en";
    labels: CallLogLabels;
    refreshToken: number;
    onCall: (entry: CallLogEntry) => void;
    onOpen: (conversationId: string) => void;
}) {
    const [entries, setEntries] = useState<CallLogEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!supabase || !userId) { setEntries([]); setLoading(false); return; }
        const { data } = await supabase.from("calls")
            .select("id, conversation_id, caller_id, kind, status, created_at, answered_at, duration_seconds, caller:users!calls_caller_id_fkey(id, name, avatar), conversations(name, type, conversation_members(user_id, users(id, name, avatar))), call_participants(user_id, status, users(id, name, avatar))")
            .order("created_at", { ascending: false })
            .limit(30);
        const now = Date.now();
        const next: CallLogEntry[] = [];
        for (const row of (data ?? []) as unknown as CallRow[]) {
            const live = row.status === "ringing" || row.status === "active";
            if (live && now - new Date(row.created_at).getTime() < LIVE_GRACE_MS) continue;
            const outgoing = row.caller_id === userId;
            const isGroup = row.conversations?.type === "group";
            const mine = (row.call_participants ?? []).find(part => part.user_id === userId);
            const others = (row.call_participants ?? [])
                .filter(part => part.user_id !== userId)
                .map(part => part.users)
                .filter((person): person is Person => person !== null);
            const members = (row.conversations?.conversation_members ?? [])
                .filter(member => member.user_id !== userId && member.users !== null)
                .map(member => member.users as Person);
            const counterpart = others[0] ?? null;
            const outcome: CallLogOutcome = outgoing
                ? row.answered_at ? "answered" : row.status === "missed" ? "noAnswer" : "cancelled"
                : row.answered_at ? "answered" : "missed";
            next.push({
                id: row.id,
                conversationId: row.conversation_id,
                kind: row.kind === "video" ? "video" : "audio",
                direction: outgoing ? "outgoing" : "incoming",
                outcome: outcome === "answered" || !outgoing ? outcome : mine?.status === "declined" ? "declined" : outcome,
                title: isGroup ? row.conversations?.name ?? labels.group : counterpart?.name || row.caller?.name || labels.unknown,
                avatar: isGroup ? null : counterpart?.avatar ?? row.caller?.avatar ?? null,
                isGroup,
                createdAt: row.created_at,
                durationSeconds: row.answered_at ? row.duration_seconds : null,
                targets: (isGroup ? members : others).map(person => ({ id: person.id, name: person.name ?? "", avatar: person.avatar ?? null }))
            });
        }
        setEntries(next);
        setLoading(false);
    }, [supabase, userId, labels.group, labels.unknown]);

    useEffect(() => { void load(); }, [load, refreshToken]);

    useEffect(() => {
        const onVisible = () => { if (document.visibilityState === "visible") void load(); };
        window.addEventListener("focus", onVisible);
        document.addEventListener("visibilitychange", onVisible);
        return () => { window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
    }, [load]);

    return <div className="call-log">
        {loading && entries.length === 0 && <div className="call-log-empty"><span className="spinner" aria-hidden="true" /></div>}
        {!loading && entries.length === 0 && <p className="call-log-empty">{labels.empty}</p>}
        {entries.map(entry => {
            const outcome = entry.outcome === "answered"
                ? entry.durationSeconds !== null && entry.durationSeconds > 0 ? formatDuration(entry.durationSeconds, language) : labels.answered
                : entry.outcome === "missed" ? labels.missed
                    : entry.outcome === "declined" ? labels.declined
                        : entry.outcome === "noAnswer" ? labels.noAnswer
                            : labels.cancelled;
            return <div key={entry.id} className="call-log-item">
                <span className={`call-log-icon ${entry.outcome === "missed" ? "missed" : ""}`} aria-hidden="true">{entry.kind === "video" ? "📹" : "📞"}</span>
                <button className="call-log-open" type="button" onClick={() => onOpen(entry.conversationId)}>
                    <span className="conversation-line">
                        <span className="call-log-name">{entry.title}</span>
                        <span className="conversation-time">{formatWhen(entry.createdAt, language)}</span>
                    </span>
                    <span className={`call-log-meta ${entry.outcome === "missed" ? "missed" : ""}`}>{entry.direction === "outgoing" ? "↗" : "↙"} {outcome}</span>
                </button>
                {entry.targets.length > 0 && <button className="call-log-back" type="button" aria-label={labels.callBack} title={labels.callBack} onClick={() => onCall(entry)}>📞</button>}
            </div>;
        })}
    </div>;
}
