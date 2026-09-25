import { createHmac, timingSafeEqual } from "node:crypto";

// Signed session cookie: "<kind>.<id>.<expiresAtMs>.<hmac>". No DB access here,
// so the proxy can use it for a fast optimistic check. kind is "a" (advisor) or "c" (customer).

export const SESSION_COOKIE = "sd_session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours, in seconds

export type SessionKind = "advisor" | "customer";
export type Session = { kind: SessionKind; id: string };

const KIND_CODE: Record<SessionKind, string> = { advisor: "a", customer: "c" };

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set. Add it to .env.local.");
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(kind: SessionKind, id: string) {
  const payload = `${KIND_CODE[kind]}.${id}.${Date.now() + SESSION_MAX_AGE * 1000}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns who the token belongs to when it is authentic and unexpired. */
export function readSessionToken(token: string | undefined): Session | null {
  if (!token) return null;
  const [code, id, expires, signature] = token.split(".");
  if (!code || !id || !expires || !signature) return null;

  const expected = Buffer.from(sign(`${code}.${id}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expires) < Date.now()) return null;

  const kind = code === "a" ? "advisor" : code === "c" ? "customer" : null;
  return kind ? { kind, id } : null;
}

/** Where each kind of user lands after signing in. */
export const HOME: Record<SessionKind, string> = { advisor: "/service-due", customer: "/chat" };
