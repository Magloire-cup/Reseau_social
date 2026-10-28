// This entry is bundled only by harness.mjs, never by a production route.
// Boundary: real PulseApp, conversation list and all messaging components/CSS;
// mocked identity, in-memory query/realtime transport, AI, profiles, calls and PWA.
import { createRoot } from "react-dom/client";
import PulseApp from "../../components/PulseApp";
import { emitMessageUpdate, queries } from "./mocks";

const params = new URLSearchParams(location.search);
localStorage.setItem("pulse-language", params.get("language") === "fr" ? "fr" : "en");
localStorage.setItem("pulse-theme", params.get("theme") === "dark" ? "dark" : "light");
localStorage.setItem("pulse-install-hidden", "1");
localStorage.setItem("pulse-notify", "0");
// Do not exercise orphan-file maintenance even against the local storage mock.
localStorage.setItem("pulse-voice-cleanup", String(Date.now()));

const fixture = {
    emitMessageUpdate, queries,
    clipboard: { fail: false, writes: [] as string[] }
};
Object.defineProperty(window, "pulseFixture", { value: fixture });
Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text: string) => {
        if (fixture.clipboard.fail) throw new DOMException("Fixture clipboard denied", "NotAllowedError");
        fixture.clipboard.writes.push(text);
    }
} });
createRoot(document.getElementById("root")!).render(<PulseApp />);
