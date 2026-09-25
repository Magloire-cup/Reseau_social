import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function makeId(prefix: string): string {
    return `${prefix}-${randomBytes(10).toString("hex")}`;
}

export function makeUserCode(): string {
    return `PULSE-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function hashPassword(password: string, salt = randomBytes(16).toString("hex")): Promise<string> {
    const key = await scrypt(password, salt, 64) as Buffer;
    return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [salt, key] = String(stored).split(":");
    if (!salt || !key) return false;
    const derived = await scrypt(password, salt, 64) as Buffer;
    const expected = Buffer.from(key, "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function signSession(token: string, secret: string): string {
    return createHash("sha256").update(`${token}:${secret}`).digest("hex");
}

export function constantTimeStringEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}

export function validEmail(value: unknown): value is string {
    return typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}
