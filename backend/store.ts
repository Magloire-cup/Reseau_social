import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./types.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataFile = join(root, "data", "pulse.json");
const emptyDatabase: Database = { users: [], conversations: [] };

export function readDatabase(): Database {
    try {
        const data = JSON.parse(readFileSync(dataFile, "utf8")) as Database;
        return { users: data.users || [], conversations: data.conversations || [] };
    } catch {
        return structuredClone(emptyDatabase);
    }
}

export function writeDatabase(database: Database): void {
    mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(dataFile, JSON.stringify(database, null, 2), "utf8");
}

if (!existsSync(dataFile)) writeDatabase(emptyDatabase);
