"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: "accepted" | "dismissed" }> };
export type DevicePlatform = "android" | "ios" | "desktop";

export function detectPlatform(): DevicePlatform {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return "android";
    // iPadOS 13+ se présente comme un Mac, mais reste tactile.
    if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    return "desktop";
}

/** Installation PWA : capture l'invite du navigateur, suit l'état « déjà installée » et enregistre le service worker. */
export function useInstallPrompt() {
    const [canInstall, setCanInstall] = useState(false);
    const [installed, setInstalled] = useState(false);
    const [platform, setPlatform] = useState<DevicePlatform>("desktop");
    const promptRef = useRef<InstallPromptEvent | null>(null);

    useEffect(() => {
        setPlatform(detectPlatform());
        const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
        setInstalled(standalone);
        if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => {});
        const onPrompt = (event: Event) => {
            event.preventDefault();
            promptRef.current = event as InstallPromptEvent;
            setCanInstall(true);
        };
        const onInstalled = () => {
            promptRef.current = null;
            setCanInstall(false);
            setInstalled(true);
        };
        window.addEventListener("beforeinstallprompt", onPrompt);
        window.addEventListener("appinstalled", onInstalled);
        return () => {
            window.removeEventListener("beforeinstallprompt", onPrompt);
            window.removeEventListener("appinstalled", onInstalled);
        };
    }, []);

    const promptInstall = useCallback(async () => {
        const event = promptRef.current;
        if (!event) return "unavailable" as const;
        try {
            await event.prompt();
            const choice = await event.userChoice;
            if (choice?.outcome === "accepted") {
                setInstalled(true);
                return "accepted" as const;
            }
            return "dismissed" as const;
        } finally {
            promptRef.current = null;
            setCanInstall(false);
        }
    }, []);

    return { canInstall, installed, platform, promptInstall };
}
