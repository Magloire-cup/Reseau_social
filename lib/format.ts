// Le drapeau `online` peut rester bloqué à true si le client disparaît sans prévenir
// (l'écriture de déconnexion est annulée par le navigateur) : on le recoupe avec la
// fraîcheur de `last_seen`, alimentée par un battement toutes les 60 s.
export function isRecentlyOnline(online: boolean | null | undefined, lastSeen: string | null | undefined, windowMs = 150000) {
    if (!online) return false;
    if (!lastSeen) return true;
    const then = new Date(lastSeen).getTime();
    if (!Number.isFinite(then)) return true;
    return Date.now() - then < windowMs;
}

export function formatLastSeen(iso: string | null | undefined, language: "fr" | "en") {
    if (!iso) return language === "fr" ? "Vu récemment" : "Seen recently";
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return language === "fr" ? "Vu récemment" : "Seen recently";
    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return language === "fr" ? "Vu à l'instant" : "Last seen just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return language === "fr" ? `Vu il y a ${minutes} min` : `Last seen ${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return language === "fr" ? `Vu il y a ${hours} h` : `Last seen ${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return language === "fr" ? `Vu il y a ${days} j` : `Last seen ${days} d ago`;
    return language === "fr" ? `Vu le ${new Date(then).toLocaleDateString("fr-FR")}` : `Last seen on ${new Date(then).toLocaleDateString("en-US")}`;
}
