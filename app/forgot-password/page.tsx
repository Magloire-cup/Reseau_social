import type { Metadata } from "next";
import PulseApp from "../../components/PulseApp";

export const metadata: Metadata = {
    title: "Mot de passe oublié",
    description: "Réinitialise ton mot de passe Pulse Messenger en toute sécurité.",
    robots: { index: false, follow: true }
};

export default function ForgotPasswordPage() {
    return <PulseApp initialMode="login" />;
}
