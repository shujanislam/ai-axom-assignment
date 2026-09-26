import "server-only";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { sql } from "@/lib/db";
import { readSessionToken, SESSION_COOKIE } from "./session";

export type Advisor = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
};

/**
 * Stored passwords are plain text in the current data. Hashes in the form
 * "scrypt$<salt>$<hex>" are also accepted, so rows can be migrated one by one.
 */
function passwordMatches(stored: string, given: string) {
  let expected: Buffer;
  let actual: Buffer;
  if (stored.startsWith("scrypt$")) {
    const [, salt, hash] = stored.split("$");
    expected = Buffer.from(hash, "hex");
    actual = scryptSync(given, salt, expected.length);
  } else {
    expected = Buffer.from(stored);
    actual = Buffer.from(given);
  }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function verifyCredentials(username: string, password: string): Promise<Advisor | null> {
  const rows = await sql`
    SELECT id, name, username, email, role, password
    FROM advisors
    WHERE lower(username) = lower(${username})
    LIMIT 1`;
  const row = rows[0];
  if (!row || !passwordMatches(row.password, password)) return null;
  return { id: row.id, name: row.name, username: row.username, email: row.email, role: row.role };
}

async function currentSession() {
  return readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** The signed-in advisor for this request, or null. Deduplicated per render. */
export const getCurrentAdvisor = cache(async (): Promise<Advisor | null> => {
  const session = await currentSession();
  if (session?.kind !== "advisor") return null;
  const rows = await sql`SELECT id, name, username, email, role FROM advisors WHERE id = ${session.id}`;
  return (rows[0] as Advisor | undefined) ?? null;
});

export type CustomerAccount = { id: string; name: string; email: string };

/** Customers sign in with their email. Customers without a password cannot sign in. */
export async function verifyCustomerCredentials(email: string, password: string): Promise<CustomerAccount | null> {
  const rows = await sql`
    SELECT id, name, email, password FROM customers
    WHERE lower(email) = lower(${email}) AND password IS NOT NULL
    LIMIT 1`;
  const row = rows[0];
  if (!row || !passwordMatches(row.password, password)) return null;
  return { id: row.id, name: row.name, email: row.email };
}

/** The signed-in customer for this request, or null. Deduplicated per render. */
export const getCurrentCustomer = cache(async (): Promise<CustomerAccount | null> => {
  const session = await currentSession();
  if (session?.kind !== "customer") return null;
  const rows = await sql`SELECT id, name, email FROM customers WHERE id = ${session.id}`;
  return (rows[0] as CustomerAccount | undefined) ?? null;
});
