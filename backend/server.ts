import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { readDatabase, writeDatabase } from "./store.js";
import { constantTimeStringEqual, hashPassword, makeId, makeUserCode, signSession, validEmail, verifyPassword } from "./security.js";
import type { Conversation, Database, PublicUser, User } from "./types.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.SESSION_SECRET || "development-only-secret";
const sessions = new Map<string, { userId: string; expiresAt: number }>();
const presence = new Map<string, number>();
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const contentTypes: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };

function json(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    response.end(JSON.stringify(body));
}

function cookies(request: IncomingMessage): Record<string, string> {
    return Object.fromEntries((request.headers.cookie || "").split(";").filter(Boolean).map(item => {
        const [key, ...value] = item.trim().split("=");
        return [key, decodeURIComponent(value.join("="))];
    }));
}

function body(request: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let raw = "";
        request.on("data", chunk => { raw += chunk; if (raw.length > 300000) reject(new Error("Request too large")); });
        request.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error("JSON invalide")); } });
        request.on("error", reject);
    });
}

function rateLimit(request: IncomingMessage, key: string, limit: number, windowMs: number): boolean {
    const id = `${key}:${request.socket.remoteAddress || "unknown"}`;
    const now = Date.now();
    const current = rateLimits.get(id) || { count: 0, resetAt: now + windowMs };
    if (current.resetAt < now) { current.count = 0; current.resetAt = now + windowMs; }
    current.count += 1;
    rateLimits.set(id, current);
    return current.count <= limit;
}

function publicUser(user: User): PublicUser {
    return { id: user.id, code: user.code, name: user.name, email: user.email, online: (presence.get(user.id) || 0) > Date.now() - 30000 };
}

function sessionUser(request: IncomingMessage, database: Database): User | null {
    const value = cookies(request).pulse_session;
    if (!value) return null;
    const [token, signature] = value.split(".");
    if (!token || !signature || !constantTimeStringEqual(signature, signSession(token, sessionSecret))) return null;
    const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now()) return null;
    return database.users.find(user => user.id === session.userId) || null;
}

function setSession(user: User, response: ServerResponse): void {
    const token = Buffer.from(`${user.id}:${Date.now()}:${Math.random()}`).toString("base64url");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + 604800000 });
    response.setHeader("Set-Cookie", `pulse_session=${token}.${signSession(token, sessionSecret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
}

function requireUser(request: IncomingMessage, response: ServerResponse, database: Database): User | null {
    const user = sessionUser(request, database);
    if (!user) { json(response, 401, { error: "Authentification requise." }); return null; }
    presence.set(user.id, Date.now() + 30000);
    return user;
}

function publicConversation(conversation: Conversation, user: User): Conversation & { messages: Conversation["messages"] } {
    const other = conversation.memberIds.map(id => readDatabase().users.find(item => item.id === id)).find(item => item && item.id !== user.id);
    return {
        ...conversation,
        contactOnline: Boolean(other && (presence.get(other.id) || 0) > Date.now() - 30000),
        blocked: Boolean(other && blocked(readDatabase(), user, other)),
        messages: conversation.messages.map(message => ({ ...message, outgoing: message.authorId === user.id }))
    };
}

function findTarget(database: Database, value: string): User | undefined {
    const normalized = value.trim().toLowerCase();
    return database.users.find(user => user.code.toLowerCase() === normalized || user.email === normalized);
}

function blocked(database: Database, first: User, second: User): boolean {
    return first.blockedUserIds.includes(second.id) || second.blockedUserIds.includes(first.id);
}

function localAi(prompt: string, language: string): string {
    const english = language === "en";
    if (/bonjour|salut|hello|hi/i.test(prompt)) return english ? "Hello. I can help you write a message, summarize an exchange, or organize an idea." : "Bonjour. Je peux t'aider à rédiger un message, résumer un échange ou organiser une idée.";
    if (/résum|resume|summar/i.test(prompt)) return english ? "Send me the conversation or its key points and I will turn it into a clear summary." : "Envoie-moi la conversation ou ses points importants et je te préparerai un résumé clair.";
    return english ? `I understood: “${prompt}”. I can rewrite it in a shorter, warmer, or more professional style.` : `J'ai compris : « ${prompt} ». Je peux le reformuler en version courte, chaleureuse ou professionnelle.`;
}

async function askAi(prompt: string, language: string): Promise<string> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return localAi(prompt, language);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: language === "en" ? "You are Pulse AI. Answer in clear English." : "Tu es Pulse AI. Réponds en français clair." }] }, contents: [{ parts: [{ text: prompt }] }] }) });
    if (!response.ok) return localAi(prompt, language);
    const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return result.candidates?.[0]?.content?.parts?.[0]?.text || localAi(prompt, language);
}

async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
    const database = readDatabase();
    if (pathname === "/api/health") return json(response, 200, { ok: true, service: "pulse" });

    if (pathname === "/api/auth/register" || pathname === "/api/auth/login") {
        if (request.method !== "POST" || !rateLimit(request, pathname, 10, 60000)) return json(response, 429, { error: "Trop de tentatives. Réessaie plus tard." });
        const input = await body(request);
        const email = String(input.email || "").trim().toLowerCase();
        const password = String(input.password || "");
        if (!validEmail(email) || password.length < 8) return json(response, 400, { error: "Email ou mot de passe invalide." });
        if (pathname.endsWith("register")) {
            if (database.users.some(user => user.email === email)) return json(response, 409, { error: "Cette adresse possède déjà un compte." });
            const user: User = { id: makeId("user"), code: makeUserCode(), name: String(input.name || "").trim().slice(0, 80), email, passwordHash: await hashPassword(password), blockedUserIds: [], createdAt: Date.now() };
            if (user.name.length < 2) return json(response, 400, { error: "Le nom est obligatoire." });
            database.users.push(user); writeDatabase(database); setSession(user, response); presence.set(user.id, Date.now() + 30000);
            return json(response, 201, { user: publicUser(user) });
        }
        const user = database.users.find(item => item.email === email);
        if (!user || !(await verifyPassword(password, user.passwordHash))) return json(response, 401, { error: "Email ou mot de passe incorrect." });
        setSession(user, response); presence.set(user.id, Date.now() + 30000);
        return json(response, 200, { user: publicUser(user) });
    }

    if (pathname === "/api/auth/me") {
        const user = sessionUser(request, database);
        return user ? json(response, 200, { user: publicUser(user) }) : json(response, 401, { error: "Session absente." });
    }
    if (pathname === "/api/auth/logout") {
        const token = cookies(request).pulse_session?.split(".")[0];
        if (token) sessions.delete(token);
        return json(response, 200, { ok: true }, { "Set-Cookie": "pulse_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    }

    const user = requireUser(request, response, database);
    if (!user) return;

    const userCodeMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userCodeMatch && request.method === "GET") {
        const target = findTarget(database, decodeURIComponent(userCodeMatch[1]));
        return target ? json(response, 200, { user: publicUser(target) }) : json(response, 404, { error: "Utilisateur introuvable." });
    }
    const blockMatch = pathname.match(/^\/api\/users\/([^/]+)\/block$/);
    if (blockMatch && (request.method === "POST" || request.method === "DELETE")) {
        const target = findTarget(database, decodeURIComponent(blockMatch[1]));
        if (!target || target.id === user.id) return json(response, 404, { error: "Utilisateur introuvable." });
        user.blockedUserIds = user.blockedUserIds.filter(id => id !== target.id);
        if (request.method === "POST") user.blockedUserIds.push(target.id);
        writeDatabase(database);
        return json(response, 200, { blocked: request.method === "POST", user: publicUser(target) });
    }
    if (pathname === "/api/presence" && request.method === "POST") return json(response, 200, { online: true, user: publicUser(user) });
    if (pathname === "/api/ai" && request.method === "POST") {
        const input = await body(request);
        const prompt = String(input.prompt || "").trim();
        if (!prompt || prompt.length > 4000) return json(response, 400, { error: "Question invalide." });
        return json(response, 200, { text: await askAi(prompt, input.language === "en" ? "en" : "fr") });
    }
    if (pathname === "/api/conversations" && request.method === "GET") return json(response, 200, { conversations: database.conversations.filter(item => item.memberIds.includes(user.id)).map(item => publicConversation(item, user)) });
    if (pathname === "/api/conversations" && request.method === "POST") {
        const input = await body(request);
        const target = findTarget(database, String(input.code || input.email || ""));
        if (!target || target.id === user.id) return json(response, 404, { error: "Code utilisateur introuvable." });
        if (blocked(database, user, target)) return json(response, 403, { error: "Cette personne est bloquée." });
        const existing = database.conversations.find(item => item.type === "direct" && item.memberIds.includes(user.id) && item.memberIds.includes(target.id));
        if (existing) return json(response, 200, { conversation: publicConversation(existing, user) });
        const conversation: Conversation = { id: makeId("conversation"), type: "direct", name: target.name, email: target.email, memberIds: [user.id, target.id], messages: [], createdAt: Date.now() };
        database.conversations.unshift(conversation); writeDatabase(database);
        return json(response, 201, { conversation: publicConversation(conversation, user) });
    }
    const messageMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messageMatch) {
        const conversation = database.conversations.find(item => item.id === messageMatch[1] && item.memberIds.includes(user.id));
        if (!conversation) return json(response, 404, { error: "Conversation introuvable." });
        const otherId = conversation.memberIds.find(id => id !== user.id);
        const other = database.users.find(item => item.id === otherId);
        if (other && blocked(database, user, other)) return json(response, 403, { error: "La conversation est bloquée." });
        if (request.method === "GET") return json(response, 200, { messages: conversation.messages.map(message => ({ ...message, outgoing: message.authorId === user.id })), online: Boolean(other && (presence.get(other.id) || 0) > Date.now() - 30000), blocked: Boolean(other && blocked(database, user, other)) });
        if (request.method === "POST") {
            const input = await body(request);
            const text = String(input.text || "").trim();
            if (!text || text.length > 4000) return json(response, 400, { error: "Message invalide." });
            conversation.messages.push({ id: makeId("message"), authorId: user.id, author: user.name, text, createdAt: Date.now() });
            writeDatabase(database);
            return json(response, 201, { message: { ...conversation.messages.at(-1), outgoing: true } });
        }
    }

    return json(response, 404, { error: "Route introuvable." });
}

async function sendContact(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!rateLimit(request, "contact", 3, 3600000)) return json(response, 429, { error: "Trop de messages envoyés." });
    const input = await body(request);
    if (String(input.website || "").trim()) return json(response, 200, { ok: true });
    const name = String(input.name || "").trim();
    const email = String(input.email || "").trim().toLowerCase();
    const message = String(input.message || "").trim();
    if (name.length < 2 || !validEmail(email) || message.length < 10) return json(response, 400, { error: "Formulaire incomplet." });
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return json(response, 503, { error: "SMTP non configuré." });
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: process.env.SMTP_SECURE !== "false", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await transporter.sendMail({ from: process.env.SMTP_USER, to: process.env.CONTACT_TO || "maglo9501@gmail.com", replyTo: email, subject: `Message Pulse de ${name}`, text: `Nom: ${name}\nEmail: ${email}\n\n${message}` });
    return json(response, 200, { ok: true });
}

function serveStatic(request: IncomingMessage, response: ServerResponse): void {
    const requested = new URL(request.url || "/", "http://localhost").pathname;
    const safePath = normalize(requested === "/" ? "/index.html" : requested).replace(/^([.][.][/\\])+/, "");
    const filePath = join(root, safePath);
    if (!filePath.startsWith(root) || !existsSync(filePath)) return void json(response, 404, { error: "Fichier introuvable." });
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
}

createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
        if (request.method === "OPTIONS") return json(response, 204, {});
        if (pathname === "/api/contact" && request.method === "POST") return await sendContact(request, response);
        if (pathname.startsWith("/api/")) return await handleApi(request, response, pathname);
        if (request.method === "GET") return serveStatic(request, response);
        return json(response, 405, { error: "Méthode non autorisée." });
    } catch (error) {
        console.error(error);
        return json(response, 500, { error: "Erreur interne du serveur." });
    }
}).listen(port, () => console.log(`Pulse TypeScript disponible sur http://localhost:${port}`));
