"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";

export type ProfileLabels = {
    title: string;
    changePhoto: string;
    uploading: string;
    badType: string;
    failed: string;
    logout: string;
    close: string;
};

type ProfileModalProps = {
    userId: string;
    email?: string;
    name: string;
    avatar: string | null;
    labels: ProfileLabels;
    onAvatarSaved: (url: string) => void;
    onClose: () => void;
    onLogout: () => void;
};

const MAX_SIDE = 512;

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

export function ProfileModal({ userId, email, name, avatar, labels, onAvatarSaved, onClose, onLogout }: ProfileModalProps) {
    const supabase = useMemo(() => createClient(), []);
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [preview, setPreview] = useState(avatar || "");
    const [uploading, setUploading] = useState(false);
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
            setSaved(true);
            onAvatarSaved(publicUrl);
        } catch {
            setError(labels.failed);
        } finally {
            setUploading(false);
        }
    }

    return <div className="modal-overlay" onClick={onClose}>
        <div className="modal profile-modal" onClick={event => event.stopPropagation()}>
            <h3>{labels.title}</h3>
            <div className="profile-avatar-preview"><img className="avatar" src={preview || "/images/default-avatar.svg"} alt="" /></div>
            <strong className="profile-name">{name || email}</strong>
            {email && <small className="profile-email">{email}</small>}
            <input ref={fileRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} />
            <button className="primary" type="button" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? labels.uploading : labels.changePhoto}</button>
            {error && <span className="error">{error}</span>}
            {saved && <span className="profile-saved">✓</span>}
            <button className="danger-button" type="button" onClick={onLogout}>{labels.logout}</button>
            <button className="modal-close" type="button" onClick={onClose}>{labels.close}</button>
        </div>
    </div>;
}
