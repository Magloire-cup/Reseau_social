import type { Metadata } from "next";
import PulseApp from "../../../components/PulseApp";

export const metadata: Metadata = {
    title: "Créer un compte",
    description: "Crée ton compte Pulse Messenger : messagerie, appels et assistant Gemini AI."
};

export default function SignUpPage() {
    return <PulseApp initialMode="register" />;
}
