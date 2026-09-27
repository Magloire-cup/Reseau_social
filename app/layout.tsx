import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = "https://reseau-social-xshx.vercel.app";
const TITLE = "Pulse Messenger — Messagerie moderne avec Gemini AI";
const DESCRIPTION = "Pulse Messenger : messagerie moderne et sécurisée avec appels vocaux et vidéo, messages vocaux, discussions de groupe et assistant Gemini AI.";

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: { default: TITLE, template: "%s · Pulse Messenger" },
    description: DESCRIPTION,
    applicationName: "Pulse Messenger",
    keywords: ["Pulse Messenger", "messagerie", "messagerie instantanée", "chat", "appels vocaux", "appels vidéo", "messages vocaux", "discussions de groupe", "Gemini AI", "assistant IA"],
    category: "communication",
    robots: {
        index: true,
        follow: true,
        googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 }
    },
    openGraph: {
        type: "website",
        url: SITE_URL,
        siteName: "Pulse Messenger",
        title: TITLE,
        description: DESCRIPTION,
        locale: "fr_FR",
        images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Pulse Messenger" }]
    },
    twitter: {
        card: "summary",
        title: TITLE,
        description: DESCRIPTION,
        images: ["/icons/icon-512.png"]
    },
    icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/favicon.svg", type: "image/svg+xml" }], shortcut: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: "Pulse Messenger", statusBarStyle: "default" },
    manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#00a884" };

const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Pulse Messenger",
    url: SITE_URL,
    description: DESCRIPTION,
    applicationCategory: "CommunicationApplication",
    operatingSystem: "Web",
    browserRequirements: "Requires JavaScript",
    inLanguage: ["fr", "en"],
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return <html lang="fr"><body>{children}<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} /></body></html>;
}
