const form = document.querySelector("#contactForm");
const status = document.querySelector("#contactStatus");

form?.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const data = Object.fromEntries(new FormData(form));
    button.disabled = true;
    status.textContent = "Envoi en cours...";
    status.dataset.type = "success";

    try {
        if (window.location.protocol === "file:") throw new Error("Ouvre le site avec le serveur Node pour envoyer un email.");
        const response = await fetch("/api/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Le message n'a pas pu être envoyé.");
        form.reset();
        status.textContent = "Message envoyé. Merci, nous revenons vers toi rapidement.";
    } catch (error) {
        status.textContent = error.message;
        status.dataset.type = "error";
    } finally {
        button.disabled = false;
    }
});
