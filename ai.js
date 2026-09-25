const languageKey = "pulse-language";
const translations = {
    fr: { title: "Ton assistant, dans ton espace.", help: "Pose une question, prépare un message ou demande une reformulation.", placeholder: "Écrire à Pulse AI...", greeting: "Bonjour. Je peux t'aider à rédiger, résumer ou organiser une idée.", waiting: "Pulse AI réfléchit..." },
    en: { title: "Your assistant, in your space.", help: "Ask a question, draft a message, or request a rewrite.", placeholder: "Write to Pulse AI...", greeting: "Hello. I can help you draft, summarize, or organize an idea.", waiting: "Pulse AI is thinking..." }
};
const $ = selector => document.querySelector(selector);
const getLanguage = () => localStorage.getItem(languageKey) || "fr";

function applyLanguage(language = getLanguage()) {
    const selected = translations[language] ? language : "fr";
    const values = translations[selected];
    document.documentElement.lang = selected;
    localStorage.setItem(languageKey, selected);
    $("#languageSelect").value = selected;
    $("[data-i18n=aiTitle]").textContent = values.title;
    $("[data-i18n=aiHelp]").textContent = values.help;
    $("#aiInput").placeholder = values.placeholder;
}

$("#languageSelect").addEventListener("change", event => applyLanguage(event.target.value));
applyLanguage();

$("#aiForm").addEventListener("submit", async event => {
    event.preventDefault();
    const input = $("#aiInput");
    const messages = $("#aiMessages");
    const prompt = input.value.trim();
    if (!prompt) return;
    const userBubble = document.createElement("div");
    userBubble.className = "ai-bubble user-ai-bubble";
    userBubble.textContent = prompt;
    messages.append(userBubble);
    input.value = "";
    $("#aiStatus").textContent = translations[getLanguage()].waiting;
    try {
        if (window.location.protocol === "file:") throw new Error("Serveur requis");
        const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ prompt, language: getLanguage() }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "IA indisponible");
        const answer = document.createElement("div");
        answer.className = "ai-bubble";
        answer.textContent = result.text;
        messages.append(answer);
        $("#aiStatus").textContent = "";
    } catch (error) {
        $("#aiStatus").textContent = "Connecte-toi au serveur Pulse pour utiliser l'IA.";
    }
    messages.scrollTop = messages.scrollHeight;
});
