"use client";

import { useState } from "react";
import { useInstallPrompt } from "../../lib/useInstallPrompt";

export function InstallAppSection() {
    const { canInstall, installed, platform, promptInstall } = useInstallPrompt();
    const [feedback, setFeedback] = useState("");

    async function install() {
        const result = await promptInstall();
        setFeedback(result === "accepted" ? "Installation lancée : confirme dans la fenêtre du navigateur." : result === "unavailable" ? "Suis les étapes de la page d'installation pour ton appareil." : "");
    }

    return <div className="settings-install">
        <h2>Application mobile</h2>
        <p>Installe Pulse sur ton téléphone : lancement en un geste, plein écran et notifications.</p>
        {installed
            ? <p className="profile-installed">✓ Application installée sur cet appareil.</p>
            : canInstall
                ? <button className="secondary install-button" type="button" onClick={() => void install()}>📲 Installer l'application</button>
                : platform === "ios"
                    ? <p className="profile-ios-hint">Sur iPhone/iPad : bouton Partager puis « Sur l'écran d'accueil ».</p>
                    : <p className="profile-ios-hint">L'installation automatique n'est pas disponible ici.</p>}
        {feedback && <p className="notice">{feedback}</p>}
        <a className="profile-install-help" href="/download">Comment installer ?</a>
    </div>;
}
