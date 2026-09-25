const themeButton = document.querySelector("#pageThemeButton");
const toast = text => {
    const element = document.createElement("div");
    element.className = "social-toast";
    element.textContent = text;
    document.body.append(element);
    window.setTimeout(() => element.remove(), 2800);
};

if (themeButton) {
    const updateTheme = () => {
        const dark = localStorage.getItem("pulse-theme") === "dark";
        document.body.classList.toggle("dark", dark);
        themeButton.textContent = dark ? "☾" : "☼";
    };
    updateTheme();
    themeButton.addEventListener("click", () => {
        localStorage.setItem("pulse-theme", document.body.classList.contains("dark") ? "light" : "dark");
        updateTheme();
    });
}

document.querySelectorAll(".conversation-tools .icon-button").forEach(button => {
    button.addEventListener("click", () => toast(`${button.title} : cette option est prête pour une future connexion serveur.`));
});

document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        const search = document.querySelector("#chatSearch");
        if (search) {
            event.preventDefault();
            search.focus();
        }
    }
});

const historyPanel = document.querySelector("#loginHistory");
if (historyPanel) {
    const user = JSON.parse(localStorage.getItem("pulse-user") || "null");
    const history = JSON.parse(localStorage.getItem("pulse-login-history") || "[]");
    if (user) {
        document.querySelector("#profilePageName")?.replaceChildren(document.createTextNode(user.name));
        document.querySelector("#profilePageAvatar")?.replaceChildren(document.createTextNode((user.name || "P").slice(0, 1).toUpperCase()));
        document.querySelector("#profilePageStatus")?.replaceChildren(document.createTextNode(`Dernière connexion : ${new Date(user.lastLogin).toLocaleString("fr-FR")}`));
        document.querySelector("#profileLoginCount")?.replaceChildren(document.createTextNode(String(user.loginCount || 1)));
        const state = JSON.parse(localStorage.getItem("pulse-demo-state") || "{}");
        document.querySelector("#profileContactCount")?.replaceChildren(document.createTextNode(String((state.conversations || []).filter(item => item.type === "direct" && item.email !== "pulse@local.demo").length)));
    }
    if (history.length) {
        historyPanel.innerHTML = history.slice(0, 6).map(entry => `<div class="login-entry"><span class="login-dot ${entry.success ? "success" : "failed"}"></span><div><strong>${entry.success ? "Connexion réussie" : "Tentative refusée"}</strong><span>${new Date(entry.loggedAt).toLocaleString("fr-FR")}</span></div></div>`).join("");
    }
}
