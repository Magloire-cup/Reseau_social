"use client";

import { ChangeEvent, FormEvent, useMemo, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";

export type ProfileLabels = {
    title: string;
    changePhoto: string;
    uploading: string;
    badType: string;
    failed: string;
    logout: string;
    close: string;
    name: string;
    username: string;
    bio: string;
    bioPlaceholder: string;
    save: string;
    saving: string;
    saved: string;
    usernameTaken: string;
    usernameInvalid: string;
    install: string;
    iosInstallHint: string;
    installed: string;
};

export type ProfileValues = { name: string; username: string | null; status: string; avatar: string | null };

type ProfileModalProps = {
    userId: string;
    email?: string;
    name: string;
    username: string | null;
    status: string | null;
    avatar: string | null;
    labels: ProfileLabels;
    install: { canInstall: boolean; isIos: boolean; installed: boolean };
    onInstall: () => void;
    onSaved: (values: ProfileValues) => void;
    onClose: () => void;
    onLogout: () => void;
};

const MAX_SIDE = 512;
const USERNAME_PATTERN = /^[a-z0-9._]{3,30}$/;

async function toSquareWebp(file: File): Promise<{ blob: Blob; contentType: string; extension: string }> {
    const fallback = { blob: file, contentType: file.type || "image/jpeg", extension: file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg" };
    if (typeof createImageBitmap !== "function") return fallback;
    try {
        const bitmap = await createImageBitmap(file);
        const side = Math.min(bitmap.width, bitmap.height);
        if (!side) { bitmap.close(); return fallback; }
        const canvas = document.createElement("canvas");
        canvas.width = MAX_SIDE;
        canvas.height = MAX_SIDE;
        const context = canvas.getContext("2d");
        if (!context) { bitmap.close(); return fallback; }
        context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, MAX_SIDE, MAX_SIDE);
        bitmap.close();
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.85));
        return blob && blob.size > 0 ? { blob, contentType: "image/webp", extension: "webp" } : fallback;
    } catch {
        return fallback;
    }
}

export function ProfileModal({ userId, email, name, username, status, avatar, labels, install, onInstall, onSaved, onClose, onLogout }: ProfileModalProps) {
    const supabase = useMemo(() => createClient(), []);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [preview, setPreview] = useState(avatar || "");
    const [nameValue, setNameValue] = useState(name || "");
    const [usernameValue, setUsernameValue] = useState(username || "");
    const [statusValue, setStatusValue] = useState(status || "");
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [saved, setSaved] = useState(false);

    async function handleFile(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setError("");
        setSaved(false);
        if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError(labels.badType); return; }
        if (!supabase) { setError(labels.failed); return; }
        setUploading(true);
        try {
            const { blob, contentType, extension } = await toSquareWebp(file);
            const path = `${userId}/avatar.${extension}`;
            const upload = await supabase.storage.from("avatars").upload(path, blob, { contentType, upsert: true, cacheControl: "3600" });
            if (upload.error) throw new Error(upload.error.message);
            const { data } = supabase.storage.from("avatars").getPublicUrl(path);
            const publicUrl = `${data.publicUrl}?v=${Date.now()}`;
            const update = await supabase.from("users").update({ avatar: publicUrl }).eq("id", userId);
            if (update.error) throw new Error(update.error.message);
            // L'ancienne photo pouvait avoir une autre extension : on la supprime pour libérer l'espace.
            const stale = ["jpg", "png", "webp"].filter(candidate => candidate !== extension).map(candidate => `${userId}/avatar.${candidate}`);
            void supabase.storage.from("avatars").remove(stale);
            setPreview(publicUrl);
            onSaved({ name: nameValue.trim() || name, username: usernameValue, status: statusValue, avatar: publicUrl });
        } catch {
            setError(labels.failed);
        } finally {
            setUploading(false);
        }
    }

    async function saveProfile(event: FormEvent) {
        event.preventDefault();
        setError("");
        setSaved(false);
        const trimmedName = nameValue.trim();
        const normalized = usernameValue.trim().toLowerCase();
        if (!trimmedName) return;
        if (normalized && !USERNAME_PATTERN.test(normalized)) { setError(labels.usernameInvalid); return; }
        if (!supabase || saving) return;
        setSaving(true);
        try {
            const update = await supabase.from("users").update({
                name: trimmedName,
                username: normalized || null,
                status: statusValue.trim().slice(0, 100) || "Disponible",
            }).eq("id", userId);
            if (update.error) {
                setError(update.error.code === "23505" ? labels.usernameTaken : labels.failed);
                return;
            }
            setUsernameValue(normalized);
            setSaved(true);
            onSaved({ name: trimmedName, username: normalized || null, status: statusValue.trim().slice(0, 100) || "Disponible", avatar: preview || null });
        } catch {
            setError(labels.failed);
        } finally {
            setSaving(false);
        }
    }

    return <div className="modal-overlay" onClick={onClose}>
        <div className="modal profile-modal" onClick={event => event.stopPropagation()}>
            <h3>{labels.title}</h3>
            <div className="profile-avatar-preview"><img className="avatar" src={preview || "/images/default-avatar.svg"} alt="" /></div>
            <input ref={fileRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} />
            <button className="secondary" type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? labels.uploading : labels.changePhoto}</button>
            {email && <small className="profile-email">{email}</small>}
            <form className="profile-form" onSubmit={saveProfile}>
                <label>{labels.name}<input value={nameValue} maxLength={80} onChange={event => setNameValue(event.target.value)} /></label>
                <label>{labels.username}<input value={usernameValue} maxLength={30} onChange={event => setUsernameValue(event.target.value)} placeholder="pseudo" /></label>
                <label>{labels.bio}<input value={statusValue} maxLength={100} onChange={event => setStatusValue(event.target.value)} placeholder={labels.bioPlaceholder} /></label>
                <button className="primary" type="submit" disabled={saving || !nameValue.trim()}>{saving ? labels.saving : labels.save}</button>
            </form>
            {error && <span className="error">{error}</span>}
            {saved && <span className="profile-saved">{labels.saved}</span>}
            {install.installed
                ? <small className="profile-installed">{labels.installed}</small>
                : install.canInstall
                    ? <button className="secondary install-button" type="button" onClick={onInstall}>{labels.install}</button>
                    : install.isIos ? <small className="profile-ios-hint">{labels.iosInstallHint}</small> : null}
            <button className="danger-button" type="button" onClick={onLogout}>{labels.logout}</button>
            <button className="modal-close" type="button" onClick={onClose}>{labels.close}</button>
        </div>
    </div>;
}
