import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(prefix: "apw" | "apr"): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function generateId(prefix = ""): string {
  const id = randomBytes(12).toString("hex");
  return prefix ? `${prefix}_${id}` : id;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function signSession(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHash("sha256")
    .update(`${body}.${secret}`)
    .digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession<T extends object>(
  token: string,
  secret: string
): T | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHash("sha256")
    .update(`${body}.${secret}`)
    .digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
