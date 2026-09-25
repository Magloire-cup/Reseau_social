const STORAGE_KEY = "pulse-demo-state";
const THEME_KEY = "pulse-theme";
const SERVER_MODE = window.location.protocol !== "file:";

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

async function apiRequest(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Le serveur est indisponible.");
    return body;
}

async function loadServerConversations() {
    const result = await apiRequest("/api/conversations");
    state.conversations = result.conversations || [];
    state.activeConversationId = state.activeConversationId && state.conversations.some(item => item.id === state.activeConversationId) ? state.activeConversationId : state.conversations[0]?.id || null;
    saveState();
}

async function refreshActiveConversation() {
    if (!SERVER_MODE || !state.activeConversationId) return;
    try {
        const result = await apiRequest(`/api/conversations/${encodeURIComponent(state.activeConversationId)}/messages`);
        const conversation = state.conversations.find(item => item.id === state.activeConversationId);
        if (!conversation) return;
        conversation.messages = result.messages || [];
        renderMessages(conversation);
        renderConversations();
    } catch {
        // Keep the current messages visible during a temporary network interruption.
    }
}

function loadState() {
    try {
        return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    } catch {
        return { ...defaultState };
    }
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

async function authenticate(form, register = false) {
    const data = new FormData(form);
    const email = data.get("email").trim().toLowerCase();
    const password = data.get("password");

    if (SERVER_MODE) {
        try {
            const result = await apiRequest(register ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify({ name: data.get("name")?.trim(), email, password }) });
            state.currentUser = result.user;
            await loadServerConversations();
            setMessage(authMessage, "", "success");
            showApp();
        } catch (error) {
            setMessage(authMessage, error.message);
        }
        return;
    }

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

conversationList.addEventListener("click", event => {
    const conversationItem = event.target.closest("[data-conversation-id]");
    if (conversationItem) openConversation(conversationItem.dataset.conversationId);
});

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

$("#newChatForm").addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
        let conversation;
        if (SERVER_MODE) {
            const result = await apiRequest("/api/conversations", { method: "POST", body: JSON.stringify({ email: data.get("email").trim().toLowerCase(), name: data.get("name").trim() }) });
            conversation = result.conversation;
            state.conversations.unshift(conversation);
        } else {
            conversation = addConversation(data.get("email").trim().toLowerCase(), data.get("name").trim());
        }
        closeDialog($("#newChatDialog"));
        event.currentTarget.reset();
        openConversation(conversation.id);
    } catch (error) {
        setMessage($("#chatFormMessage"), error.message);
    }
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

$("#messageForm").addEventListener("submit", async event => {
    event.preventDefault();
    const input = $("#messageInput");
    const text = input.value.trim();
    const conversation = state.conversations.find(item => item.id === state.activeConversationId);
    if (!text || !conversation) return;
    try {
        let message;
        if (SERVER_MODE) {
            const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversation.id)}/messages`, { method: "POST", body: JSON.stringify({ text }) });
            message = result.message;
        } else {
            message = { id: makeId("message"), author: state.currentUser.name, text, outgoing: true, createdAt: Date.now() };
        }
        conversation.messages.push(message);
        input.value = "";
        saveState();
        renderMessages(conversation);
        renderConversations();
    } catch (error) {
        setMessage(authMessage, error.message);
    }
});

$("#chatSearch").addEventListener("input", renderConversations);
$$(".filter-button[data-filter]").forEach(button => button.addEventListener("click", () => {
    $$(".filter-button[data-filter]").forEach(item => item.classList.toggle("active", item === button));
    renderConversations();
}));

$("#profileButton").addEventListener("click", () => $("#profileMenu").classList.toggle("hidden"));
$("#logoutButton").addEventListener("click", async () => {
    if (SERVER_MODE) await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => {});
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

async function restoreSession() {
    if (!SERVER_MODE) {
        if (state.currentUser) showApp();
        return;
    }
    try {
        const result = await apiRequest("/api/auth/me");
        state.currentUser = result.user;
        await loadServerConversations();
        showApp();
    } catch {
        state.currentUser = null;
        showAuth();
    }
}

restoreSession();
window.setInterval(refreshActiveConversation, 5000);
