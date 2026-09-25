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

document.querySelectorAll(".status-story:not(.own-story)").forEach(story => {
    story.addEventListener("click", () => toast(`Le statut de ${story.querySelector("small").textContent} sera bientôt disponible.`));
});

document.querySelector(".own-story")?.addEventListener("click", () => toast("La publication de statut sera disponible dans la prochaine version."));

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
