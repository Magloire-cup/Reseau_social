import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 3000);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon"
};

function sendJson(response, status, body) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "http://localhost:3000",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
    });
    response.end(JSON.stringify(body));
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let raw = "";
        request.on("data", chunk => {
            raw += chunk;
            if (raw.length > 200000) reject(new Error("Request too large"));
        });
        request.on("end", () => resolve(raw));
        request.on("error", reject);
    });
}

async function handleGemini(request, response) {
    if (!process.env.GEMINI_API_KEY) {
        return sendJson(response, 500, { error: "GEMINI_API_KEY est absente du fichier .env." });
    }

    try {
        const body = JSON.parse(await readBody(request));
        const contents = Array.isArray(body.contents) ? body.contents.slice(-20) : [];
        if (!contents.length) return sendJson(response, 400, { error: "La conversation est vide." });

        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents,
            config: {
                systemInstruction: "Tu es Gemini, l'assistant intégré à Pulse. Réponds en français, de manière professionnelle, concise et utile. Tu peux aider à rédiger, résumer et organiser une conversation, mais tu ne dois jamais prétendre envoyer un message à la place de l'utilisateur."
            }
        });

        sendJson(response, 200, { text: result.text || "Je n'ai pas de réponse pour le moment." });
    } catch (error) {
        console.error("Gemini error:", error.message);
        sendJson(response, 502, { error: "Gemini est momentanément indisponible." });
    }
}

function serveStatic(request, response) {
    const requested = request.url === "/" ? "/index.html" : request.url.split("?")[0];
    const safePath = normalize(requested).replace(/^([.][.][/\\])+/, "");
    const filePath = join(root, safePath);
    if (!filePath.startsWith(root) || !existsSync(filePath)) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
    }
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(response);
}

createServer(async (request, response) => {
    if (request.method === "OPTIONS") return sendJson(response, 204, {});
    if (request.method === "POST" && request.url === "/api/gemini") return handleGemini(request, response);
    if (request.method === "GET") return serveStatic(request, response);
    sendJson(response, 405, { error: "Method not allowed" });
}).listen(port, () => {
    console.log(`Pulse est disponible sur http://localhost:${port}`);
});
