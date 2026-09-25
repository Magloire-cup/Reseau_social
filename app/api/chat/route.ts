import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { createServerSupabase } from "../../../lib/supabase/server";

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

        const supabase = await createServerSupabase();
        let currentUserId: string | null = null;
        if (supabase) {
            const auth = await supabase.auth.getUser();
            if (auth.error || !auth.data.user) return NextResponse.json({ error: "Vous devez être connecté." }, { status: 401 });
            currentUserId = auth.data.user.id;
            const membership = await supabase.from("conversation_members").select("conversation_id").eq("conversation_id", body.conversationId).eq("user_id", currentUserId).maybeSingle();
            if (membership.error || !membership.data) return NextResponse.json({ error: "Conversation inaccessible." }, { status: 403 });
            if (last.role === "user") await supabase.from("messages").insert({ conversation_id: body.conversationId, sender_id: currentUserId, content: last.content, type: "text", status: "sent" });
        }

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
        const message = { id: crypto.randomUUID(), role: "assistant" as const, content, createdAt: new Date().toISOString() };
        if (supabase && currentUserId) await supabase.from("messages").insert({ id: message.id, conversation_id: body.conversationId, sender_id: null, content, type: "ai", status: "sent" });
        return NextResponse.json({ message });
    } catch (error) {
        console.error("/api/chat", error);
        return NextResponse.json({ error: "Impossible de générer la réponse Gemini." }, { status: 502 });
    }
}