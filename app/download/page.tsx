import type { Metadata } from "next";
import { DownloadPanel } from "../../components/download/DownloadPanel";

export const metadata: Metadata = {
    title: "Télécharger l'application",
    description: "Installe Pulse Messenger sur ton téléphone Android ou iPhone en quelques secondes : lancement en un geste, plein écran, notifications. Gratuit, sans magasin d'applications.",
    alternates: { canonical: "/download" }
};

export default function DownloadPage() {
    return <DownloadPanel />;
}
