import { GoogleGenAI } from "@google/genai";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type InputMessage = { role: "user" | "model"; content: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fallback(prompt: string, language: string) {
    return language === "en"
        ? `I understood: “${prompt}”. I can help you rewrite, summarize, or organize this idea.`
        : `J'ai compris : « ${prompt} ». Je peux t'aider à reformuler, résumer ou organiser cette idée.`;
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as { conversationId?: string; messages?: InputMessage[]; language?: string; userMessageId?: string };
        const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
        const last = messages.at(-1);
        if (!body.conversationId || !last?.content?.trim()) return NextResponse.json({ error: "Message invalide." }, { status: 400 });
        if (last.content.length > 4000) return NextResponse.json({ error: "Message trop long." }, { status: 413 });

        const { userId } = await auth();
        if (!userId) return NextResponse.json({ error: "Vous devez être connecté." }, { status: 401 });

        const supabase = await createServerSupabase();
        if (supabase) {
            const membership = await supabase.from("conversation_members").select("conversation_id").eq("conversation_id", body.conversationId).eq("user_id", userId).maybeSingle();
            if (membership.error || !membership.data) return NextResponse.json({ error: "Conversation inaccessible." }, { status: 403 });
            if (last.role === "user") {
                const userMessageId = body.userMessageId && uuidPattern.test(body.userMessageId) ? body.userMessageId : null;
                await supabase.from("messages").insert({ id: userMessageId ?? undefined, conversation_id: body.conversationId, sender_id: userId, content: last.content, type: "text", status: "sent" });
            }
        }

        let content = fallback(last.content, body.language === "en" ? "en" : "fr");
        if (process.env.GEMINI_API_KEY) {
            const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const contents = messages.map(message => ({ role: message.role, parts: [{ text: message.content }] }));
            const config = { systemInstruction: body.language === "en" ? "You are Gemini AI inside Pulse. Be concise and helpful in English." : "Tu es Gemini AI dans Pulse. Réponds en français, avec clarté et concision." };
            const models = [...new Set([process.env.GEMINI_MODEL || "gemini-3.8-flash", "gemini-3.7-flash", "gemini-flash-latest"])];
            // Les modèles sont tentés en parallèle : la latence Gemini varie beaucoup et la
            // boucle séquentielle dépassait le temps imparti avant d'obtenir une réponse.
            const attempts = models.map(async model => {
                const result = await ai.models.generateContent({ model, contents, config: { ...config, abortSignal: AbortSignal.timeout(20000) } });
                if (!result.text) throw new Error(`Réponse vide (${model})`);
                return result.text;
            });
            try {
                content = await Promise.any(attempts);
            } catch (error) {
                console.error("Gemini indisponible :", error);
            }
        }
        const message = { id: crypto.randomUUID(), role: "assistant" as const, content, createdAt: new Date().toISOString() };
        if (supabase) await supabase.from("messages").insert({ id: message.id, conversation_id: body.conversationId, sender_id: null, content, type: "ai", status: "sent" });
        return NextResponse.json({ message });
    } catch (error) {
        console.error("/api/chat", error);
        return NextResponse.json({ error: "Impossible de générer la réponse Gemini." }, { status: 502 });
    }
}