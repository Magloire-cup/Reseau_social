"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useInstallPrompt, type DevicePlatform } from "../../lib/useInstallPrompt";

const PROD_URL = "https://reseau-social-xshx.vercel.app";

const copy = {
    fr: {
        brand: "Pulse Messenger",
        eyebrow: "APPLICATION MOBILE",
        title: "Télécharger l'application",
        lede: "Installe Pulse sur ton téléphone : lancement en un geste, plein écran, notifications, et tes conversations restent synchronisées.",
        installNow: "Installer maintenant",
        accepted: "Installation lancée : confirme dans la fenêtre du navigateur.",
        unavailable: "L'installation automatique n'est pas disponible ici : suis les étapes de ton appareil ci-dessous.",
        installed: "L'application est déjà installée sur cet appareil.",
        openApp: "Ouvrir la messagerie",
        manualHint: "Rien ne se passe ? Suis les étapes ci-dessous, ça marche partout.",
        detected: "Ton appareil",
        qrTitle: "Depuis un ordinateur ?",
        qrHint: "Scanne ce code avec l'appareil photo de ton téléphone pour ouvrir Pulse Messenger dessus, puis installe-le.",
        free: "Gratuit, sans magasin d'applications ni compte supplémentaire.",
        footBack: "← Retour à la messagerie",
        platforms: {
            android: { title: "Android", subtitle: "Chrome, Edge, Samsung Internet", steps: ["Ouvre Pulse Messenger dans le navigateur.", "Appuie sur le menu ⋮ en haut à droite.", "Choisis « Installer l'application » (ou « Ajouter à l'écran d'accueil »).", "Confirme : l'icône Pulse apparaît sur ton écran d'accueil."] },
            ios: { title: "iPhone / iPad", subtitle: "Safari", steps: ["Ouvre Pulse Messenger dans Safari.", "Appuie sur le bouton Partager (carré avec une flèche).", "Fais défiler le menu et choisis « Sur l'écran d'accueil ».", "Appuie sur « Ajouter » : l'icône Pulse apparaît."] },
            desktop: { title: "Ordinateur", subtitle: "Chrome, Edge", steps: ["Clique sur l'icône d'installation à droite de la barre d'adresse.", "Ou ouvre le menu ⋮ puis « Installer Pulse Messenger ».", "L'app s'ouvre dans sa propre fenêtre, comme un logiciel."] }
        }
    },
    en: {
        brand: "Pulse Messenger",
        eyebrow: "MOBILE APP",
        title: "Download the app",
        lede: "Install Pulse on your phone: one-tap launch, full screen, notifications, and your conversations stay in sync.",
        installNow: "Install now",
        accepted: "Installation started: confirm in the browser dialog.",
        unavailable: "Automatic install is not available here: follow the steps for your device below.",
        installed: "The app is already installed on this device.",
        openApp: "Open the messenger",
        manualHint: "Nothing happens? Follow the steps below, they work everywhere.",
        detected: "Your device",
        qrTitle: "On a computer?",
        qrHint: "Scan this code with your phone camera to open Pulse Messenger on it, then install it.",
        free: "Free, no app store and no extra account required.",
        footBack: "← Back to the messenger",
        platforms: {
            android: { title: "Android", subtitle: "Chrome, Edge, Samsung Internet", steps: ["Open Pulse Messenger in the browser.", "Tap the ⋮ menu in the top right.", "Choose “Install app” (or “Add to Home screen”).", "Confirm: the Pulse icon appears on your home screen."] },
            ios: { title: "iPhone / iPad", subtitle: "Safari", steps: ["Open Pulse Messenger in Safari.", "Tap the Share button (square with an arrow).", "Scroll the menu and choose “Add to Home Screen”.", "Tap “Add”: the Pulse icon appears."] },
            desktop: { title: "Computer", subtitle: "Chrome, Edge", steps: ["Click the install icon at the right of the address bar.", "Or open the ⋮ menu then “Install Pulse Messenger”.", "The app opens in its own window, like a desktop program."] }
        }
    }
};

export function DownloadPanel() {
    const [language, setLanguage] = useState<"fr" | "en">("fr");
    const [origin, setOrigin] = useState(PROD_URL);
    const [feedback, setFeedback] = useState("");
    const { canInstall, installed, platform, promptInstall } = useInstallPrompt();
    const t = copy[language];

    useEffect(() => {
        const saved = window.localStorage.getItem("pulse-language");
        if (saved === "en" || saved === "fr") setLanguage(saved);
        document.documentElement.dataset.theme = window.localStorage.getItem("pulse-theme") === "dark" ? "dark" : "light";
        // Sur un poste local, le QR doit pointer vers la version en ligne pour être utile au téléphone.
        if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") setOrigin(window.location.origin);
    }, []);

    const order: DevicePlatform[] = platform === "android" ? ["android", "ios", "desktop"] : platform === "ios" ? ["ios", "android", "desktop"] : ["desktop", "android", "ios"];

    async function install() {
        const result = await promptInstall();
        setFeedback(result === "accepted" ? t.accepted : result === "unavailable" ? t.unavailable : "");
    }

    return <main className="download">
        <section className="download-card">
            <header className="download-head">
                <div className="brand"><span className="brand-mark">✦</span>{t.brand}</div>
                <div className="top-actions"><button className="icon-button" type="button" onClick={() => { const next = language === "fr" ? "en" : "fr"; setLanguage(next); window.localStorage.setItem("pulse-language", next); }}>{language.toUpperCase()}</button></div>
            </header>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1>{t.title}</h1>
            <p className="download-lede">{t.lede}</p>

            <div className="download-action">
                {installed
                    ? <p className="download-installed">✓ {t.installed}</p>
                    : canInstall
                        ? <button className="primary download-primary" type="button" onClick={() => void install()}>📲 {t.installNow}</button>
                        : <a className="primary download-primary" href="/">{t.openApp}</a>}
                {!installed && <p className="download-note">{canInstall ? t.manualHint : t.unavailable}</p>}
                {feedback && <p className="notice">{feedback}</p>}
            </div>

            {platform === "desktop" && !installed && <div className="download-qr">
                <div>
                    <h3>{t.qrTitle}</h3>
                    <p>{t.qrHint}</p>
                </div>
                <div className="download-qr-code"><QRCodeSVG value={origin} size={148} fgColor="#1f2c32" bgColor="#ffffff" marginSize={2} /></div>
            </div>}

            <div className="download-platforms">
                {order.map(key => <article key={key} className={`download-platform ${key === platform ? "detected" : ""}`}>
                    <header>
                        <h3>{t.platforms[key].title}{key === platform && <span className="download-tag">{t.detected}</span>}</h3>
                        <small>{t.platforms[key].subtitle}</small>
                    </header>
                    <ol className="download-steps">{t.platforms[key].steps.map(step => <li key={step}>{step}</li>)}</ol>
                </article>)}
            </div>

            <footer className="download-foot"><span>{t.free}</span><a href="/">{t.footBack}</a></footer>
        </section>
    </main>;
}
