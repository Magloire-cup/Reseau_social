const STORAGE_KEY = "pulse-demo-state";
const THEME_KEY = "pulse-theme";
const LANG_KEY = "pulse-language";

const translations = {
    fr: {
        spaceEyebrow: "TON ESPACE",
        messagesTitle: "Messages",
        searchPlaceholder: "Rechercher une conversation",
        allFilter: "Tout",
        unreadFilter: "Non lus",
        groupAction: "＋ Groupe",
        pulseReady: "Pulse est prêt",
        emptyConversationTitle: "Choisis une conversation",
        emptyConversationText: "Ouvre un échange ou commence une nouvelle discussion avec une adresse email.",
        newConversationButton: "Nouvelle conversation",
        messagePlaceholder: "Écrire un message...",
        profileLabel: "Profil",
        logoutLabel: "Se déconnecter",
        aiButton: "IA",
        documentTitle: "Pulse | Conversations qui comptent"
    },
    en: {
        spaceEyebrow: "YOUR SPACE",
        messagesTitle: "Messages",
        searchPlaceholder: "Search a conversation",
        allFilter: "All",
        unreadFilter: "Unread",
        groupAction: "＋ Group",
        pulseReady: "Pulse is ready",
        emptyConversationTitle: "Choose a conversation",
        emptyConversationText: "Open a chat or start a new conversation with an email address.",
        newConversationButton: "New conversation",
        messagePlaceholder: "Write a message...",
        profileLabel: "Profile",
        logoutLabel: "Log out",
        aiButton: "AI",
        documentTitle: "Pulse | Meaningful conversations"
    }
};

const defaultState = {
    currentUser: null,
    conversations: [],
    activeConversationId: null,
    statuses: []
};

const state = loadState();
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const authView = $("#authView");
const socialApp = $("#socialApp");
const authMessage = $("#authMessage");
const conversationList = $("#conversationList");
const emptyConversation = $("#emptyConversation");
const activeConversation = $("#activeConversation");
const workspace = $(".workspace");

function loadState() {
    try {
        return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    } catch {
        return { ...defaultState };
    }
}

function applyLanguage(locale = localStorage.getItem(LANG_KEY) || "fr") {
    const lang = translations[locale] ? locale : "fr";
    const values = translations[lang];
    document.documentElement.lang = lang;
    localStorage.setItem(LANG_KEY, lang);
    document.title = values.documentTitle;

    document.querySelectorAll("[data-i18n]").forEach(node => {
        const key = node.dataset.i18n;
        if (values[key]) node.textContent = values[key];
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(node => {
        const key = node.dataset.i18nPlaceholder;
        if (values[key]) node.placeholder = values[key];
    });

    const profileLabel = document.getElementById("profileName");
    if (profileLabel) profileLabel.textContent = state.currentUser ? state.currentUser.name : values.profileLabel;
    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton) logoutButton.textContent = values.logoutLabel;
    const aiButtonLabel = document.querySelector(".ai-nav-button span:last-child");
    if (aiButtonLabel) aiButtonLabel.textContent = values.aiButton;
    const languageSelect = document.getElementById("languageSelect");
    const languageIndicator = document.querySelector(".language-label");
    if (languageSelect) languageSelect.value = lang;
    if (languageIndicator) languageIndicator.textContent = lang.toUpperCase();
}

function bindLanguageSelector() {
    const languageSelect = document.getElementById("languageSelect");
    if (!languageSelect) return;
    languageSelect.addEventListener("change", event => applyLanguage(event.target.value));
    applyLanguage(languageSelect.value || localStorage.getItem(LANG_KEY) || "fr");
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
}

function makeId(prefix = "id") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function initials(name) {
    return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "P";
}

function formatTime(timestamp) {
    return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function formatDay(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return "Aujourd'hui";
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }).format(date);
}

function setMessage(element, text, type = "error") {
    element.textContent = text;
    element.dataset.type = type;
}

function showApp() {
    authView.classList.add("hidden");
    socialApp.classList.remove("hidden");
    $("#profileName").textContent = state.currentUser.name;
    $("#profileAvatar").textContent = initials(state.currentUser.name);
    renderConversations();
    if (state.activeConversationId) openConversation(state.activeConversationId);
}

function showAuth() {
    authView.classList.remove("hidden");
    socialApp.classList.add("hidden");
}

function authenticate(form, register = false) {
    const data = new FormData(form);
    const email = data.get("email").trim().toLowerCase();
    const password = data.get("password");

    if (register) {
        const name = data.get("name").trim();
        if (!name) return setMessage(authMessage, "Choisis un nom affiché.");
        state.currentUser = { name, email, password, createdAt: Date.now(), lastLogin: Date.now(), loginCount: 1 };
        state.conversations = [];
        state.activeConversationId = null;
        recordLogin(state.currentUser, true);
    } else {
        const savedUser = JSON.parse(localStorage.getItem("pulse-user") || "null");
        if (!savedUser || savedUser.email !== email || savedUser.password !== password) {
            recordLogin({ email }, false);
            return setMessage(authMessage, "Email ou mot de passe incorrect. Crée d'abord un compte de démonstration.");
        }
        savedUser.lastLogin = Date.now();
        savedUser.loginCount = (savedUser.loginCount || 0) + 1;
        state.currentUser = savedUser;
        localStorage.setItem("pulse-user", JSON.stringify(savedUser));
        recordLogin(savedUser, true);
    }

    if (register) localStorage.setItem("pulse-user", JSON.stringify(state.currentUser));
    saveState();
    setMessage(authMessage, "", "success");
    showApp();
}

function recordLogin(user, success) {
    const history = JSON.parse(localStorage.getItem("pulse-login-history") || "[]");
    history.unshift({ email: user.email, name: user.name || "Compte inconnu", success, loggedAt: Date.now() });
    localStorage.setItem("pulse-login-history", JSON.stringify(history.slice(0, 15)));
}

function getSavedConversations() {
    return state.conversations.filter(conversation => conversation.type === "group" || conversation.email !== "pulse@local.demo");
}

function renderConversations() {
    const query = $("#chatSearch").value.trim().toLowerCase();
    const onlyUnread = $(".filter-button.active")?.dataset.filter === "unread";
    const filtered = getSavedConversations().filter(conversation => {
        const matchesText = `${conversation.name} ${conversation.email || ""}`.toLowerCase().includes(query);
        return matchesText && (!onlyUnread || conversation.unread);
    });

    if (!filtered.length) {
        conversationList.innerHTML = '<p class="empty-list">Aucune conversation trouvée.</p>';
        return;
    }

    conversationList.innerHTML = filtered.map(conversation => {
        const lastMessage = conversation.messages.at(-1);
        const avatar = conversation.type === "group" ? "♧" : initials(conversation.name);
        return `<button class="conversation-item ${conversation.id === state.activeConversationId ? "active" : ""}" type="button" data-conversation-id="${conversation.id}">
            <span class="avatar">${avatar}</span>
            <span class="conversation-copy"><span class="conversation-topline"><span class="conversation-name">${escapeHtml(conversation.name)}</span><span class="conversation-time">${lastMessage ? formatTime(lastMessage.createdAt) : ""}</span></span><span class="conversation-preview">${escapeHtml(lastMessage?.text || "Nouvelle conversation")}</span></span>
            ${conversation.unread ? '<span class="unread-dot"></span>' : ""}
        </button>`;
    }).join("");
}

function openConversation(id) {
    const conversation = state.conversations.find(item => item.id === id);
    if (!conversation) return;
    state.activeConversationId = id;
    conversation.unread = false;
    saveState();
    emptyConversation.classList.add("hidden");
    activeConversation.classList.remove("hidden");
    workspace.classList.add("mobile-conversation");
    $("#activeTitle").textContent = conversation.name;
    $("#activeSubtitle").textContent = conversation.type === "group" ? `${conversation.members.length} membre${conversation.members.length > 1 ? "s" : ""}` : conversation.email;
    $("#activeAvatar").textContent = conversation.type === "group" ? "♧" : initials(conversation.name);
    renderMessages(conversation);
    renderConversations();
    $("#messageInput").focus();
}

function renderMessages(conversation) {
    const messageList = $("#messageList");
    let previousDay = "";
    messageList.innerHTML = conversation.messages.map(message => {
        const day = formatDay(message.createdAt);
        const dayLabel = day !== previousDay ? `<div class="message-day">${day}</div>` : "";
        previousDay = day;
        return `${dayLabel}<div class="message-row ${message.outgoing ? "outgoing" : ""}"><div class="message-bubble"><p class="message-text">${escapeHtml(message.text)}</p><span class="message-meta">${formatTime(message.createdAt)} ${message.outgoing ? "✓✓" : ""}</span></div></div>`;
    }).join("");
    messageList.scrollTop = messageList.scrollHeight;
}

function addConversation(email, name = "") {
    const existing = state.conversations.find(item => item.email === email && item.type === "direct");
    if (existing) return existing;
    const conversation = { id: makeId("chat"), type: "direct", name: name || email.split("@")[0], email, members: [], unread: false, status: "Disponible", messages: [] };
    state.conversations.unshift(conversation);
    saveState();
    return conversation;
}

function addGroup(name, members) {
    const conversation = { id: makeId("group"), type: "group", name, email: "", members: [...new Set(members)], unread: false, messages: [{ id: makeId("message"), author: "Pulse", text: `Groupe « ${name} » créé. Invités : ${members.join(", ")}.`, outgoing: false, createdAt: Date.now() }] };
    state.conversations.unshift(conversation);
    saveState();
    return conversation;
}

function openDialog(id) {
    const dialog = document.getElementById(id);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
    if (dialog.close) dialog.close();
    else dialog.removeAttribute("open");
}

$$("[data-auth-tab]").forEach(tab => tab.addEventListener("click", () => {
    $$("[data-auth-tab]").forEach(item => item.classList.toggle("active", item === tab));
    $$("[data-auth-form]").forEach(form => form.classList.toggle("hidden", form.dataset.authForm !== tab.dataset.authTab));
    setMessage(authMessage, "");
}));

$("#loginForm").addEventListener("submit", event => { event.preventDefault(); authenticate(event.currentTarget); });
$("#registerForm").addEventListener("submit", event => { event.preventDefault(); authenticate(event.currentTarget, true); });

$("#newChatButton").addEventListener("click", () => openDialog("newChatDialog"));
$("#emptyNewChatButton").addEventListener("click", () => openDialog("newChatDialog"));
$("#newGroupButton").addEventListener("click", () => openDialog("newGroupDialog"));

$("#newChatForm").addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const conversation = addConversation(data.get("email").trim().toLowerCase(), data.get("name").trim());
    closeDialog($("#newChatDialog"));
    event.currentTarget.reset();
    openConversation(conversation.id);
});

$("#newGroupForm").addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const members = data.get("members").split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
    if (!members.every(email => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return setMessage($("#groupFormMessage"), "Vérifie le format des emails des membres.");
    const conversation = addGroup(data.get("name").trim(), members);
    closeDialog($("#newGroupDialog"));
    event.currentTarget.reset();
    openConversation(conversation.id);
});

$("#messageForm").addEventListener("submit", event => {
    event.preventDefault();
    const input = $("#messageInput");
    const text = input.value.trim();
    const conversation = state.conversations.find(item => item.id === state.activeConversationId);
    if (!text || !conversation) return;
    conversation.messages.push({ id: makeId("message"), author: state.currentUser.name, text, outgoing: true, createdAt: Date.now() });
    input.value = "";
    saveState();
    renderMessages(conversation);
    renderConversations();
});

$("#chatSearch").addEventListener("input", renderConversations);
$$(".filter-button[data-filter]").forEach(button => button.addEventListener("click", () => {
    $$(".filter-button[data-filter]").forEach(item => item.classList.toggle("active", item === button));
    renderConversations();
}));

$("#profileButton").addEventListener("click", () => $("#profileMenu").classList.toggle("hidden"));
$("#logoutButton").addEventListener("click", () => {
    state.currentUser = null;
    state.activeConversationId = null;
    saveState();
    showAuth();
});
$("#backToSidebar").addEventListener("click", () => workspace.classList.remove("mobile-conversation"));

$$('[data-close-modal]').forEach(button => button.addEventListener("click", () => closeDialog(document.getElementById(button.dataset.closeModal))));
$$('.modal').forEach(dialog => dialog.addEventListener("click", event => { if (event.target === dialog) closeDialog(dialog); }));

function applyTheme() {
    const dark = localStorage.getItem(THEME_KEY) === "dark";
    document.body.classList.toggle("dark", dark);
    $("#themeButton").textContent = dark ? "☾" : "☼";
}

$("#themeButton").addEventListener("click", () => {
    localStorage.setItem(THEME_KEY, document.body.classList.contains("dark") ? "light" : "dark");
    applyTheme();
});

applyTheme();
bindLanguageSelector();
if (state.currentUser) showApp();
