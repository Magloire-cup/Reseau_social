import type { Metadata } from "next";
import PulseApp from "../../components/PulseApp";

export const metadata: Metadata = {
    title: "Se connecter",
    description: "Connecte-toi à Pulse Messenger pour retrouver tes conversations, tes appels et ton assistant Gemini AI.",
    alternates: { canonical: "/login" }
};

export default function LoginPage() {
    return <PulseApp initialMode="login" />;
}
