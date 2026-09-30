"use client";

import { SignIn, SignUp } from "@clerk/nextjs";

type Language = "fr" | "en";
type Labels = {
    brand: string;
    private: string;
    title: string;
    subtitle: string;
    login: string;
    register: string;
    install: string;
    loading: string;
};

const extras = {
    fr: {
        lang: "Passer en anglais",
        themeLight: "Passer en thème clair",
        themeDark: "Passer en thème sombre",
        loginHint: "Connecte-toi pour retrouver tes conversations.",
        registerHint: "Crée ton espace en quelques secondes."
    },
    en: {
        lang: "Switch to French",
        themeLight: "Switch to light theme",
        themeDark: "Switch to dark theme",
        loginHint: "Sign in to pick up your conversations.",
        registerHint: "Create your space in a few seconds."
    }
};

export function AuthScreen({
    language,
    dark,
    authMode,
    loading,
    t,
    onLanguage,
    onDark,
    onAuthMode
}: {
    language: Language;
    dark: boolean;
    authMode: "login" | "register";
    loading?: boolean;
    t: Labels;
    onLanguage: () => void;
    onDark: () => void;
    onAuthMode: (mode: "login" | "register") => void;
}) {
    const extra = extras[language];
    const clerkAppearance = {
        variables: {
            colorPrimary: "#00a884",
            colorDanger: "#bd4545",
            borderRadius: "9px",
            colorBackground: dark ? "#202c33" : "#ffffff",
            colorText: dark ? "#e9edef" : "#1f2c32",
            colorTextSecondary: dark ? "#aebac1" : "#5b6b73",
            colorInputBackground: dark ? "#2a3942" : "#ffffff",
            colorInputText: dark ? "#e9edef" : "#1f2c32",
            colorNeutral: dark ? "#aebac1" : "#5b6b73",
            spacingUnit: "0.8rem"
        },
        elements: {
            rootBox: { width: "100%" },
            card: { width: "100%", padding: "0", background: "transparent", boxShadow: "none" },
            headerTitle: { display: "none" },
            headerSubtitle: { display: "none" },
            lastAuthenticationStrategyBadge: { display: "none" },
            footer: { background: "transparent" },
            formButtonPrimary: {
                background: "#00a884",
                fontSize: "0.95rem",
                fontWeight: "800",
                textTransform: "none" as const,
                "&:hover": { background: "#019875" }
            }
        }
    };

    if (loading) {
        return (
            <main className="auth">
                <section className="auth-card auth-card-simple" aria-busy="true" aria-live="polite">
                    <div className="brand"><span className="brand-mark">✦</span>{t.brand}</div>
                    <p className="eyebrow">{t.private}</p>
                    <div className="list-status"><span className="spinner" />{t.loading}</div>
                </section>
            </main>
        );
    }

    return (
        <main className="auth">
            <section className="auth-card">
                <div className="auth-copy">
                    <div className="brand"><span className="brand-mark">✦</span>{t.brand}</div>
                    <p className="eyebrow">{t.private}</p>
                    <h1>{t.title}</h1>
                    <p>{t.subtitle}</p>
                    <div className="top-actions">
                        <button className="icon-button" type="button" onClick={onLanguage} aria-label={extra.lang} title={extra.lang}>{language.toUpperCase()}</button>
                        <button className="icon-button" type="button" onClick={onDark} aria-label={dark ? extra.themeLight : extra.themeDark} title={dark ? extra.themeLight : extra.themeDark}>{dark ? "☀" : "☾"}</button>
                    </div>
                </div>
                <div className="auth-side">
                    <div className="auth-tabs" role="tablist" aria-label={t.brand}>
                        <button type="button" role="tab" id="auth-tab-login" aria-selected={authMode === "login"} aria-controls="auth-panel" className={authMode === "login" ? "active" : ""} onClick={() => onAuthMode("login")}>{t.login}</button>
                        <button type="button" role="tab" id="auth-tab-register" aria-selected={authMode === "register"} aria-controls="auth-panel" className={authMode === "register" ? "active" : ""} onClick={() => onAuthMode("register")}>{t.register}</button>
                    </div>
                    <p className="auth-hint">{authMode === "login" ? extra.loginHint : extra.registerHint}</p>
                    <div className="auth-clerk" id="auth-panel" role="tabpanel" aria-labelledby={authMode === "login" ? "auth-tab-login" : "auth-tab-register"}>
                        {authMode === "login"
                            ? <SignIn routing="hash" appearance={clerkAppearance} fallbackRedirectUrl="/" signUpUrl="/register" />
                            : <SignUp routing="hash" appearance={clerkAppearance} fallbackRedirectUrl="/" signInUrl="/login" />}
                    </div>
                    <p className="auth-install"><a href="/download">{t.install}</a></p>
                </div>
            </section>
        </main>
    );
}
