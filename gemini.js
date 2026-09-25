const AI_HISTORY_PREFIX = "pulse-ai-conversation-";
const aiMessages = document.querySelector("#aiMessages");
const aiForm = document.querySelector("#aiForm");
const aiInput = document.querySelector("#aiInput");
const aiStatus = document.querySelector("#aiStatus");
const currentUser = JSON.parse(localStorage.getItem("pulse-user") || "null");
const userKey = currentUser?.email || "anonymous";
const historyKey = `${AI_HISTORY_PREFIX}${userKey}`;

function getHistory() {
    try { return JSON.parse(localStorage.getItem(historyKey) || "[]"); } catch { return []; }
}

function saveHistory(history) {
    localStorage.setItem(historyKey, JSON.stringify(history.slice(-20)));
}

function addMessage(text, role = "model") {
    const wrapper = document.createElement("div");
    wrapper.className = `ai-message ${role === "user" ? "user" : ""}`;
    const bubble = document.createElement("div");
    const label = document.createElement("p");
    label.className = "ai-message-label";
    label.textContent = role === "user" ? "Toi" : "Gemini · Pulse";
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
        addMessage("Je suis Gemini, l'assistant de Pulse. Je peux t'aider à rédiger, résumer ou organiser une idée.");
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
            throw new Error(data.error || data.message || responseText || "Gemini est indisponible.");
        }

        return data.text || responseText || "Je n’ai pas eu de réponse de Gemini.";
    } catch (error) {
        return buildLocalReply(latestPrompt, payload.context || getPulseContext());
    }
}

aiForm?.addEventListener("submit", async event => {
    event.preventDefault();
    const prompt = aiInput.value.trim();
    if (!prompt) return;
    const history = getHistory();
    history.push({ role: "user", parts: [{ text: prompt }], text: prompt });
    addMessage(prompt, "user");
    aiInput.value = "";
    aiStatus.textContent = "Gemini réfléchit...";
    aiForm.classList.add("ai-loading");
    try {
        const answer = await askGemini(history.map(message => ({ role: message.role, parts: message.parts || [{ text: message.text }] })));
        history.push({ role: "model", parts: [{ text: answer }], text: answer });
        addMessage(answer);
        saveHistory(history);
        aiStatus.textContent = "Mode local JS actif : réponse générée dans le navigateur.";
    } catch (error) {
        history.pop();
        saveHistory(history);
        addMessage(`Impossible de joindre Gemini : ${error.message}`);
        aiStatus.textContent = "Mode local JS actif : réponse générée directement dans le navigateur.";
    } finally {
        aiForm.classList.remove("ai-loading");
        aiInput.focus();
    }
});

document.querySelectorAll(".ai-suggestion").forEach(button => button.addEventListener("click", () => {
    aiInput.value = button.textContent;
    aiInput.focus();
}));

document.querySelector("#clearAiButton")?.addEventListener("click", () => {
    localStorage.removeItem(historyKey);
    aiMessages.innerHTML = "";
    loadConversation();
    aiStatus.textContent = "Ancienne discussion supprimée.";
});

loadConversation();
