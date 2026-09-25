import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type InputMessage = { role: "user" | "model"; content: string };

function fallback(prompt: string, language: string) {
    return language === "en"
        ? `I understood: “${prompt}”. I can help you rewrite, summarize, or organize this idea.`
        : `J'ai compris : « ${prompt} ». Je peux t'aider à reformuler, résumer ou organiser cette idée.`;
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as { conversationId?: string; messages?: InputMessage[]; language?: string };
        const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
        const last = messages.at(-1);
        if (!body.conversationId || !last?.content?.trim()) return NextResponse.json({ error: "Message invalide." }, { status: 400 });
        if (last.content.length > 4000) return NextResponse.json({ error: "Message trop long." }, { status: 413 });

        let content = fallback(last.content, body.language === "en" ? "en" : "fr");
        if (process.env.GEMINI_API_KEY) {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const result = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: messages.map(message => ({ role: message.role, parts: [{ text: message.content }] })),
                config: { systemInstruction: body.language === "en" ? "You are Gemini AI inside Pulse. Be concise and helpful in English." : "Tu es Gemini AI dans Pulse. Réponds en français, avec clarté et concision." }
            });
            content = result.text || content;
        }
        return NextResponse.json({ message: { id: crypto.randomUUID(), role: "assistant", content, createdAt: new Date().toISOString() } });
    } catch (error) {
        console.error("/api/chat", error);
        return NextResponse.json({ error: "Impossible de générer la réponse Gemini." }, { status: 502 });
    }
}