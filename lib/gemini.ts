export type GeminiMessage = { role: "user" | "model"; content: string };

export async function askGemini(conversationId: string, messages: GeminiMessage[], language: "fr" | "en") {
    const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, messages, language })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Gemini est indisponible.");
    return payload.message as { id: string; role: "assistant"; content: string; createdAt: string };
}