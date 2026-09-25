const AI_HISTORY_PREFIX = "pulse-ai-conversation-";
const LANG_KEY = "pulse-language";
const aiMessages = document.querySelector("#aiMessages");
const aiForm = document.querySelector("#aiForm");
const aiInput = document.querySelector("#aiInput");
const aiStatus = document.querySelector("#aiStatus");
const themeButton = document.querySelector("#pageThemeButton") || document.querySelector("#themeButton");
const languageSelect = document.querySelector("#pageLanguageSelect") || document.querySelector("#languageSelect");
const currentUser = JSON.parse(localStorage.getItem("pulse-user") || "null");
const userKey = currentUser?.email || "anonymous";
const historyKey = `${AI_HISTORY_PREFIX}${userKey}`;

const translations = {
    fr: {
        assistantIntro: "Je suis l’assistant Pulse. Je peux t’aider à rédiger, résumer ou organiser une idée.",
        statusThinking: "L’assistant réfléchit...",
        statusReady: "Mode local JS actif : réponse générée dans le navigateur.",
        statusError: "Mode local JS actif : réponse générée directement dans le navigateur.",
        aiStatusReady: "Prêt à discuter.",
        resetStatus: "Ancienne discussion supprimée."
    },
    en: {
        assistantIntro: "I am the Pulse assistant. I can help you draft, summarize, or organize an idea.",
        statusThinking: "The assistant is thinking...",
        statusReady: "Local JS mode active: the answer was generated in the browser.",
        statusError: "Local JS mode active: the answer was generated directly in the browser.",
        aiStatusReady: "Ready to chat.",
        resetStatus: "Previous discussion cleared."
    }
};

function applyLanguage(locale = localStorage.getItem(LANG_KEY) || "fr") {
    const lang = translations[locale] ? locale : "fr";
    const labels = document.querySelectorAll(".language-label");
    labels.forEach(label => label.textContent = lang.toUpperCase());
    if (languageSelect) languageSelect.value = lang;
    if (aiStatus) aiStatus.textContent = translations[lang].aiStatusReady;
    document.documentElement.lang = lang;
    localStorage.setItem(LANG_KEY, lang);
}

function bindLanguageSelector() {
    if (!languageSelect) return;
    languageSelect.addEventListener("change", event => applyLanguage(event.target.value));
    applyLanguage(languageSelect.value || localStorage.getItem(LANG_KEY) || "fr");
}

function setStatus(message) {
    if (aiStatus) aiStatus.textContent = message;
}

function applyTheme(theme) {
    const resolvedTheme = theme === "dark" ? "dark" : "light";
    document.body.classList.toggle("dark", resolvedTheme === "dark");
    localStorage.setItem("pulse-theme", resolvedTheme);
    if (themeButton) {
        themeButton.textContent = resolvedTheme === "dark" ? "☀" : "☼";
    }
}

function initTheme() {
    if (!themeButton) return;
    const savedTheme = localStorage.getItem("pulse-theme") || "light";
    applyTheme(savedTheme);
    themeButton.addEventListener("click", () => {
        const nextTheme = document.body.classList.contains("dark") ? "light" : "dark";
        applyTheme(nextTheme);
    });
}

function getHistory() {
    try { return JSON.parse(localStorage.getItem(historyKey) || "[]"); } catch { return []; }
}

function saveHistory(history) {
    localStorage.setItem(historyKey, JSON.stringify(history.slice(-20)));
}

function addMessage(text, role = "model") {
    if (!aiMessages) return;
    const wrapper = document.createElement("div");
    wrapper.className = `ai-message ${role === "user" ? "user" : ""}`;
    const bubble = document.createElement("div");
    const label = document.createElement("p");
    label.className = "ai-message-label";
    label.textContent = role === "user" ? "Toi" : "Assistant Pulse";
    const content = document.createElement("div");
    content.className = "ai-message-bubble";
    content.textContent = text;
    bubble.append(label, content);
    wrapper.append(bubble);
    aiMessages.append(wrapper);
    aiMessages.scrollTop = aiMessages.scrollHeight;
}

function loadConversation() {
    const history = getHistory();
    if (!history.length) {
        const lang = localStorage.getItem(LANG_KEY) || "fr";
        addMessage((translations[lang] || translations.fr).assistantIntro);
        return;
    }
    history.forEach(message => addMessage(message.text, message.role));
}

function getPulseContext() {
    try {
        const state = JSON.parse(localStorage.getItem("pulse-demo-state") || "{}");
        return (state.conversations || []).map(conversation => ({
            nom: conversation.name,
            type: conversation.type,
            messages: (conversation.messages || []).slice(-3).map(message => message.text)
        }));
    } catch { return []; }
}

function buildLocalReply(prompt, context = []) {
    const normalized = prompt.toLowerCase();
    const totalContacts = context.filter(item => item.type === "direct").length;
    const totalGroups = context.filter(item => item.type === "group").length;

    if (normalized.includes("résum") || normalized.includes("resume")) {
        const items = context.length ? context.slice(0, 3).map(item => `• ${item.nom} (${item.type === "group" ? "groupe" : "contact"})`).join("\n") : "• Aucune conversation enregistrée pour le moment.";
        return `Voici un aperçu de ton espace Pulse :\n${items}\nTu as ${totalContacts} contact${totalContacts > 1 ? "s" : ""} et ${totalGroups} groupe${totalGroups > 1 ? "s" : ""}. Le plus important est de rester clair, rapide et professionnel dans tes échanges.`;
    }

    if (normalized.includes("message") || normalized.includes("rédig") || normalized.includes("ecrire") || normalized.includes("écris") || normalized.includes("texte")) {
        return `Voici un message prêt à envoyer :\n\nBonjour,\nJe te contacte au sujet de notre discussion. Je souhaite avancer rapidement, rester clair et garder une bonne dynamique de travail. Merci de me confirmer le point de départ et la prochaine étape à suivre.\n\nBien à toi.`;
    }

    if (normalized.includes("groupe") || normalized.includes("team") || normalized.includes("équipe")) {
        return `Idée de groupe : \"Salle de travail Pulse\". \n- objectif : coordination et échanges rapides\n- membres : équipe, partenaires, clients clés\n- cadence : 1 message d'actualité par jour + 1 point de décision par semaine.`;
    }

    if (normalized.includes("bonjour") || normalized.includes("salut")) {
        return "Bonjour ! Je suis l'assistant Pulse. Je peux t'aider à rédiger un message, synthétiser des conversations ou proposer un nom de groupe.";
    }

    if (normalized.includes("merci")) {
        return "Avec plaisir. Je peux aussi t'aider à reformuler un message, organiser une réunion ou préparer le prochain groupe.";
    }

    return `J’ai bien compris : « ${prompt} ». Dans Pulse, le plus efficace est de rester simple, précis et orienté action. Si tu veux, je peux te proposer une version courte, une version plus professionnelle ou une idée de groupe.`;
}

async function askGemini(contents) {
    const payload = { contents, context: getPulseContext() };
    const latestPrompt = (contents || []).slice().reverse().find(message => message.role === "user")?.parts?.[0]?.text || "conversation";
    const lang = localStorage.getItem(LANG_KEY) || "fr";

    if (window.location.protocol === "file:") {
        return buildLocalReply(latestPrompt, payload.context || getPulseContext());
    }

    try {
        const response = await fetch("/api/gemini", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const responseText = await response.text();
        let data = {};
        try { data = JSON.parse(responseText); } catch { data = { text: responseText }; }

        if (!response.ok) {
            throw new Error(data.error || data.message || responseText || "L’assistant est indisponible.");
        }

        return data.text || responseText || "Je n’ai pas eu de réponse de l’assistant.";
    } catch (error) {
        return buildLocalReply(latestPrompt, payload.context || getPulseContext());
    }
}

if (aiForm && aiInput) {
    aiForm.addEventListener("submit", async event => {
        event.preventDefault();
        const prompt = aiInput.value.trim();
        if (!prompt) return;
        const history = getHistory();
        history.push({ role: "user", parts: [{ text: prompt }], text: prompt });
        addMessage(prompt, "user");
        aiInput.value = "";
        setStatus((translations[localStorage.getItem(LANG_KEY) || "fr"] || translations.fr).statusThinking);
        aiForm.classList.add("ai-loading");
        try {
            const answer = await askGemini(history.map(message => ({ role: message.role, parts: message.parts || [{ text: message.text }] })));
            history.push({ role: "model", parts: [{ text: answer }], text: answer });
            addMessage(answer);
            saveHistory(history);
            setStatus((translations[localStorage.getItem(LANG_KEY) || "fr"] || translations.fr).statusReady);
        } catch (error) {
            const lastMessage = history[history.length - 1];
            if (lastMessage && lastMessage.role === "user") {
                history.pop();
            }
            saveHistory(history);
            addMessage(`Impossible de joindre l’assistant : ${error.message || "erreur inconnue"}`);
            setStatus((translations[localStorage.getItem(LANG_KEY) || "fr"] || translations.fr).statusError);
        } finally {
            aiForm.classList.remove("ai-loading");
            aiInput.focus();
        }
    });
}

document.querySelectorAll(".ai-suggestion").forEach(button => button.addEventListener("click", () => {
    aiInput.value = button.textContent;
    aiInput.focus();
}));

document.querySelector("#clearAiButton")?.addEventListener("click", () => {
    localStorage.removeItem(historyKey);
    if (aiMessages) {
        aiMessages.innerHTML = "";
    }
    loadConversation();
    setStatus((translations[localStorage.getItem(LANG_KEY) || "fr"] || translations.fr).resetStatus);
});

initTheme();
bindLanguageSelector();
loadConversation();
