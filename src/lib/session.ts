import { createHmac, timingSafeEqual } from "node:crypto";

// Signed session cookie: "<advisorId>.<expiresAtMs>.<hmac>". No DB access here,
// so the proxy can use it for a fast optimistic check.

export const SESSION_COOKIE = "sd_session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours, in seconds

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set. Add it to .env.local.");
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(advisorId: string) {
  const payload = `${advisorId}.${Date.now() + SESSION_MAX_AGE * 1000}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the advisor id when the token is authentic and unexpired. */
export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [advisorId, expires, signature] = token.split(".");
  if (!advisorId || !expires || !signature) return null;

  const expected = Buffer.from(sign(`${advisorId}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expires) < Date.now()) return null;
  return advisorId;
}
