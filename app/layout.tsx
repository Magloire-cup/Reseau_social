import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Pulse | Messagerie",
    description: "Une messagerie moderne avec Gemini AI.",
    icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/favicon.svg", type: "image/svg+xml" }], shortcut: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: "Pulse", statusBarStyle: "default" },
    manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#00a884" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return <html lang="fr"><body>{children}</body></html>;
}
