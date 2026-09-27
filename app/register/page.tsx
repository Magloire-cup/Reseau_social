import type { Metadata } from "next";
import PulseApp from "../../components/PulseApp";

export const metadata: Metadata = {
    title: "Créer un compte",
    description: "Crée ton compte Pulse Messenger gratuitement : messagerie, appels vocaux et vidéo, messages vocaux, discussions de groupe et assistant Gemini AI.",
    alternates: { canonical: "/register" }
};

export default function RegisterPage() {
    return <PulseApp initialMode="register" />;
}
