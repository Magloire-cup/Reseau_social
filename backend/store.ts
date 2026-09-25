import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";
import type { Database } from "./types.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataFile = join(root, "data", "pulse.json");
const redis = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
    ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
    : null;
const emptyDatabase: Database = { users: [], conversations: [] };

export async function readDatabase(): Promise<Database> {
    if (redis) {
        const data = await redis.get<Database>("pulse:database");
        return data || structuredClone(emptyDatabase);
    }
    try {
        const data = JSON.parse(readFileSync(dataFile, "utf8")) as Database;
        return { users: data.users || [], conversations: data.conversations || [] };
    } catch {
        return structuredClone(emptyDatabase);
    }
}

export async function writeDatabase(database: Database): Promise<void> {
    if (redis) {
        await redis.set("pulse:database", database);
        return;
    }
    mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(dataFile, JSON.stringify(database, null, 2), "utf8");
}

if (!redis && !existsSync(dataFile)) writeFileSync(dataFile, JSON.stringify(emptyDatabase, null, 2), "utf8");
