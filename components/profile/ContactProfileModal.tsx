"use client";

import { formatLastSeen, isRecentlyOnline } from "../../lib/format";

export type ContactProfileLabels = {
    title: string;
    bio: string;
    noBio: string;
    online: string;
    offline: string;
    block: string;
    unblock: string;
    close: string;
};

export type ContactProfile = {
    id: string;
    name: string;
    username: string | null;
    avatar: string | null;
    online: boolean;
    status?: string | null;
    last_seen?: string | null;
};

type ContactProfileModalProps = {
    profile: ContactProfile;
    blocked: boolean;
    language: "fr" | "en";
    labels: ContactProfileLabels;
    onToggleBlock: () => void;
    onClose: () => void;
};

export function ContactProfileModal({ profile, blocked, language, labels, onToggleBlock, onClose }: ContactProfileModalProps) {
    const recently = isRecentlyOnline(profile.online, profile.last_seen);
    const presence = recently ? labels.online : profile.last_seen ? formatLastSeen(profile.last_seen, language) : labels.offline;
    return <div className="modal-overlay" onClick={onClose}>
        <div className="modal profile-modal" onClick={event => event.stopPropagation()}>
            <h3>{labels.title}</h3>
            <div className="profile-avatar-preview"><img className="avatar" src={profile.avatar || "/images/default-avatar.svg"} alt="" />{recently && <span className="profile-online-dot" />}</div>
            <strong className="profile-name">{profile.name || profile.username}</strong>
            {profile.username && <small className="profile-email">@{profile.username}</small>}
            <small className={recently ? "profile-presence online" : "profile-presence"}>{presence}</small>
            <div className="profile-bio">
                <small className="profile-bio-label">{labels.bio}</small>
                <p>{profile.status?.trim() || labels.noBio}</p>
            </div>
            {blocked ? <button className="primary" type="button" onClick={onToggleBlock}>{labels.unblock}</button>
                : <button className="danger-button" type="button" onClick={onToggleBlock}>{labels.block}</button>}
            <button className="modal-close" type="button" onClick={onClose}>{labels.close}</button>
        </div>
    </div>;
}
