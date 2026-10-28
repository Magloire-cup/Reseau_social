// Run with Node >= 22.18: node --test tests/browser/pulse.test.ts
// Requires repo dev dependencies esbuild/playwright-core and installed Chrome/Edge.
// No Next server, browser downloads, build output, secrets, SDKs or remote calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(resolve(repo, "package.json"));
const mockPath = fileURLToPath(new URL("./mocks.ts", import.meta.url));

export async function startHarness() {
    const { build } = require("esbuild");
    const { chromium } = require("playwright-core");
    const result = await build({
        absWorkingDir: repo,
        entryPoints: [fileURLToPath(new URL("./fixture.tsx", import.meta.url))],
        bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
        tsconfigRaw: { compilerOptions: { target: "ES2022", jsx: "react-jsx" } },
        define: { "process.env.NODE_ENV": '"test"' },
        metafile: true,
        plugins: [{ name: "isolated-pulse-services", setup(builder) {
            builder.onResolve({ filter: /^(?:@clerk\/nextjs|.*\/(?:supabase\/client|gemini|useVoiceCall|useInstallPrompt|ProfileModal|ContactProfileModal|AuthScreen|CallOverlay|CallLog))$/ }, () => ({ path: mockPath }));
        } }]
    });
    // A changed import must fail closed, not accidentally bring real SDKs into tests.
    const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll("\\", "/"));
    assert.ok(!inputs.some(path => /node_modules\/(?:@supabase|@clerk|@google)\//.test(path)), "External service SDK escaped fixture replacement");
    assert.ok(!inputs.some(path => /(?:^|\/)\.env(?:\.|$)/.test(path)), "Environment files are forbidden");
    const assets = new Map([
        ["/fixture.js", ["text/javascript", result.outputFiles[0].contents]],
        ["/globals.css", ["text/css", await readFile(resolve(repo, "app/globals.css"))]],
        ["/", ["text/html", '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/globals.css"><title>Isolated Pulse browser tests</title></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>']]
    ]);
    for (const name of ["default-avatar.svg", "gemini-avatar.svg"]) {
        assets.set(`/images/${name}`, ["image/svg+xml", await readFile(resolve(repo, "public/images", name))]);
    }
    const unexpected = [];
    const server = createServer((request, response) => {
        const url = new URL(request.url, "http://127.0.0.1");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'");
        const asset = assets.get(url.pathname);
        if (request.method !== "GET" || !asset) {
            unexpected.push(`${request.method} ${url.pathname}`);
            response.writeHead(501, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: "Unexpected fixture request; add an explicit test route" }));
            return;
        }
        response.writeHead(200, { "Content-Type": asset[0] });
        response.end(asset[1]);
    });
    await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveListen);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    const launchErrors = [];
    try {
        // Channel launch uses system installations and never invokes browser installers.
        for (const channel of ["chrome", "msedge"]) {
            try { browser = await chromium.launch({ channel, headless: true, args: ["--disable-background-networking"] }); break; }
            catch (error) { launchErrors.push(`${channel}: ${error.message}`); }
        }
        if (!browser) throw new Error(`Install Chrome or Edge; no browser will be downloaded.\n${launchErrors.join("\n")}`);
    } catch (error) {
        await new Promise(resolveClose => server.close(resolveClose));
        throw error;
    }
    return {
        async open(t, options = {}) {
            const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: 900 }, serviceWorkers: "block" });
            const denied = [];
            const errors = [];
            const page = await context.newPage();
            page.setDefaultTimeout(7000);
            page.on("pageerror", error => errors.push(error.message));
            await context.route("**/*", route => {
                if (new URL(route.request().url()).origin === origin) return route.continue();
                denied.push(route.request().url());
                return route.abort("blockedbyclient");
            });
            await context.routeWebSocket(/.*/, socket => { denied.push(socket.url()); socket.close(); });
            t.after(async () => {
                await context.close();
                assert.deepEqual(denied, [], "Fixture attempted a remote request or WebSocket");
                assert.deepEqual(errors, [], "Unexpected browser JavaScript error");
            });
            const params = new URLSearchParams({ language: options.language ?? "en", theme: options.theme ?? "light" });
            if (options.history) params.set("history", "1");
            await page.goto(`${origin}/?${params}`);
            await page.locator(".conversation").filter({ hasText: "Fixture Friend" }).click();
            await page.locator(".message-row").first().waitFor();
            return page;
        },
        async close() {
            try { await browser.close(); }
            finally {
                server.closeAllConnections();
                await new Promise(resolveClose => server.close(resolveClose));
            }
            assert.deepEqual(unexpected, [], "Unexpected HTTP request reached fixture server");
        }
    };
}
