import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Pulse | Messagerie",
    description: "Une messagerie moderne avec Gemini AI."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return <html lang="fr"><body>{children}</body></html>;
}