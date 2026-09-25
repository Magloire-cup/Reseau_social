import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const root = fileURLToPath(new URL(".", import.meta.url));
const dataDirectory = join(root, "data");
const dataFile = join(dataDirectory, "pulse.json");
const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.SESSION_SECRET || "development-only-secret";
const sessions = new Map();
const rateLimits = new Map();

mkdirSync(dataDirectory, { recursive: true });
if (!existsSync(dataFile)) writeFileSync(dataFile, JSON.stringify({ users: [], conversations: [] }, null, 2));

const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon"
};

function readDatabase() {
    try { return JSON.parse(readFileSync(dataFile, "utf8")); }
    catch { return { users: [], conversations: [] }; }
}

function writeDatabase(database) {
    writeFileSync(dataFile, JSON.stringify(database, null, 2));
}

function sendJson(response, status, body, headers = {}) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
    response.end(JSON.stringify(body));
}

function parseCookies(request) {
    return Object.fromEntries((request.headers.cookie || "").split(";").filter(Boolean).map(cookie => {
        const [key, ...value] = cookie.trim().split("=");
        return [key, decodeURIComponent(value.join("="))];
    }));
}

function sessionCookie(token) {
    const signature = createHash("sha256").update(`${token}:${sessionSecret}`).digest("hex");
    return `pulse_session=${token}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
}

function clearSessionCookie() {
    return "pulse_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function getUser(request) {
    const value = parseCookies(request).pulse_session;
    if (!value) return null;
    const [token, signature] = value.split(".");
    if (!token || !signature) return null;
    const expected = createHash("sha256").update(`${token}:${sessionSecret}`).digest("hex");
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now()) return null;
    const user = readDatabase().users.find(item => item.id === session.userId);
    return user ? { id: user.id, name: user.name, email: user.email } : null;
}

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
    const derivedKey = await scrypt(password, salt, 64);
    return `${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, stored) {
    const [salt, key] = String(stored).split(":");
    if (!salt || !key) return false;
    const derivedKey = await scrypt(password, salt, 64);
    const storedKey = Buffer.from(key, "hex");
    return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
}

function makeId(prefix) {
    return `${prefix}-${randomBytes(9).toString("hex")}`;
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", chunk => {
            body += chunk;
            if (body.length > 250000) reject(new Error("Request too large"));
        });
        request.on("end", () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch { reject(new Error("Invalid JSON")); }
        });
        request.on("error", reject);
    });
}

function validateEmail(email) {
    return typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function allowRate(request, key, limit = 5, windowMs = 60000) {
    const address = request.socket.remoteAddress || "unknown";
    const bucketKey = `${key}:${address}`;
    const now = Date.now();
    const bucket = rateLimits.get(bucketKey) || { count: 0, resetAt: now + windowMs };
    if (bucket.resetAt < now) { bucket.count = 0; bucket.resetAt = now + windowMs; }
    bucket.count += 1;
    rateLimits.set(bucketKey, bucket);
    return bucket.count <= limit;
}

function requireUser(request, response) {
    const user = getUser(request);
    if (!user) sendJson(response, 401, { error: "Authentification requise." });
    return user;
}

async function auth(request, response, action) {
    if (!allowRate(request, `auth:${action}`, 10)) return sendJson(response, 429, { error: "Trop de tentatives. Réessaie dans une minute." });
    const body = await readBody(request);
    const database = readDatabase();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!validateEmail(email) || password.length < 8) return sendJson(response, 400, { error: "Email ou mot de passe invalide." });

    if (action === "register") {
        if (String(body.name || "").trim().length < 2) return sendJson(response, 400, { error: "Le nom doit contenir au moins 2 caractères." });
        if (database.users.some(user => user.email === email)) return sendJson(response, 409, { error: "Cette adresse possède déjà un compte." });
        const user = { id: makeId("user"), name: String(body.name).trim().slice(0, 80), email, passwordHash: await hashPassword(password), createdAt: Date.now() };
        database.users.push(user);
        writeDatabase(database);
        return createSession(user, response);
    }

    const user = database.users.find(item => item.email === email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) return sendJson(response, 401, { error: "Email ou mot de passe incorrect." });
    return createSession(user, response);
}

function createSession(user, response) {
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + 604800000 });
    response.setHeader("Set-Cookie", sessionCookie(token));
    return sendJson(response, 200, { user: { id: user.id, name: user.name, email: user.email } });
}

function publicConversation(conversation, userId) {
    return {
        ...conversation,
        messages: (conversation.messages || []).map(message => ({ ...message, outgoing: message.authorId === userId }))
    };
}

async function handleApi(request, response, pathname) {
    if (pathname === "/api/health") return sendJson(response, 200, { ok: true });
    if (pathname === "/api/auth/register" && request.method === "POST") return auth(request, response, "register");
    if (pathname === "/api/auth/login" && request.method === "POST") return auth(request, response, "login");
    if (pathname === "/api/auth/me" && request.method === "GET") {
        const user = getUser(request);
        return user ? sendJson(response, 200, { user }) : sendJson(response, 401, { error: "Session absente." });
    }
    if (pathname === "/api/auth/logout" && request.method === "POST") {
        const value = parseCookies(request).pulse_session;
        if (value) sessions.delete(value.split(".")[0]);
        return sendJson(response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
    }

    const user = requireUser(request, response);
    if (!user) return;
    const database = readDatabase();

    if (pathname === "/api/conversations" && request.method === "GET") {
        return sendJson(response, 200, { conversations: database.conversations.filter(item => item.memberIds.includes(user.id)).map(item => publicConversation(item, user.id)) });
    }
    if (pathname === "/api/conversations" && request.method === "POST") {
        const body = await readBody(request);
        const email = String(body.email || "").trim().toLowerCase();
        if (!validateEmail(email)) return sendJson(response, 400, { error: "Adresse email invalide." });
        const contact = database.users.find(item => item.email === email);
        const conversation = { id: makeId("conversation"), type: "direct", name: String(body.name || email.split("@")[0]).trim().slice(0, 80), email, memberIds: [...new Set([user.id, contact?.id].filter(Boolean))], messages: [], createdAt: Date.now() };
        if (conversation.memberIds.length < 2) conversation.memberIds.push(user.id);
        database.conversations.unshift(conversation);
        writeDatabase(database);
        return sendJson(response, 201, { conversation: publicConversation(conversation, user.id) });
    }

    const conversationMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (conversationMatch) {
        const conversation = database.conversations.find(item => item.id === conversationMatch[1] && item.memberIds.includes(user.id));
        if (!conversation) return sendJson(response, 404, { error: "Conversation introuvable." });
        if (request.method === "GET") return sendJson(response, 200, { messages: (conversation.messages || []).map(message => ({ ...message, outgoing: message.authorId === user.id })) });
        if (request.method === "POST") {
            const body = await readBody(request);
            const text = String(body.text || "").trim();
            if (!text || text.length > 4000) return sendJson(response, 400, { error: "Message invalide." });
            const message = { id: makeId("message"), author: user.name, authorId: user.id, text, outgoing: true, createdAt: Date.now() };
            conversation.messages = conversation.messages || [];
            conversation.messages.push(message);
            writeDatabase(database);
            return sendJson(response, 201, { message });
        }
    }

    return sendJson(response, 404, { error: "Route introuvable." });
}

async function sendContact(request, response) {
    if (!allowRate(request, "contact", 3, 3600000)) return sendJson(response, 429, { error: "Trop de messages envoyés. Réessaie plus tard." });
    const body = await readBody(request);
    if (String(body.website || "").trim()) return sendJson(response, 200, { ok: true });
    const name = String(body.name || "").trim().slice(0, 100);
    const email = String(body.email || "").trim().toLowerCase();
    const message = String(body.message || "").trim().slice(0, 5000);
    if (name.length < 2 || !validateEmail(email) || message.length < 10) return sendJson(response, 400, { error: "Complète correctement le formulaire." });
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.CONTACT_TO) return sendJson(response, 503, { error: "Le service email n'est pas encore configuré sur le serveur." });
    const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: String(process.env.SMTP_SECURE || "true") === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await transporter.sendMail({ from: process.env.SMTP_USER, to: process.env.CONTACT_TO, replyTo: email, subject: `Nouveau message Pulse de ${name}`, text: `Nom: ${name}\nEmail: ${email}\n\n${message}` });
    return sendJson(response, 200, { ok: true, message: "Message envoyé." });
}

function serveStatic(request, response) {
    const requested = request.url === "/" ? "/index.html" : request.url.split("?")[0];
    const safePath = normalize(requested).replace(/^([.][.][/\\])+/, "");
    const filePath = join(root, safePath);
    if (!filePath.startsWith(root) || !existsSync(filePath)) return sendJson(response, 404, { error: "Fichier introuvable." });
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
}

createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
        if (request.method === "OPTIONS") return sendJson(response, 204, {});
        if (pathname === "/api/contact" && request.method === "POST") return await sendContact(request, response);
        if (pathname.startsWith("/api/")) return await handleApi(request, response, pathname);
        if (request.method === "GET") return serveStatic(request, response);
        return sendJson(response, 405, { error: "Méthode non autorisée." });
    } catch (error) {
        console.error(error);
        return sendJson(response, 500, { error: "Erreur interne du serveur." });
    }
}).listen(port, () => console.log(`Pulse sécurisé disponible sur http://localhost:${port}`));
