"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyCredentials, verifyCustomerCredentials } from "@/lib/server/auth";
import { createSessionToken, HOME, SESSION_COOKIE, SESSION_MAX_AGE, type SessionKind } from "@/lib/session";

export type LoginState = {
  error?: string;
  fieldErrors?: { username?: string; password?: string };
  username?: string;
  as?: SessionKind;
};

/** Only same-site relative paths, so ?next= can't bounce users off-site. */
function safeNext(value: FormDataEntryValue | null, kind: SessionKind) {
  const next = typeof value === "string" ? value : "";
  // A customer may only land in the customer area, and an advisor never there.
  const allowed = kind === "customer" ? next.startsWith("/chat") : !next.startsWith("/chat");
  return next.startsWith("/") && !next.startsWith("//") && allowed ? next : HOME[kind];
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const kind: SessionKind = formData.get("as") === "customer" ? "customer" : "advisor";
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const fieldErrors: LoginState["fieldErrors"] = {};
  if (!username) fieldErrors.username = kind === "customer" ? "Enter your email" : "Enter your username";
  if (!password) fieldErrors.password = "Enter your password";
  if (fieldErrors.username || fieldErrors.password) return { fieldErrors, username, as: kind };

  let id: string | null = null;
  if (kind === "customer") {
    id = (await verifyCustomerCredentials(username, password))?.id ?? null;
  } else {
    const advisor = await verifyCredentials(username, password);
    if (advisor && advisor.role !== "CUSTOMER") id = advisor.id;
  }
  if (!id) {
    const what = kind === "customer" ? "email" : "username";
    return { error: `That ${what} and password don’t match.`, username, as: kind };
  }

  (await cookies()).set(SESSION_COOKIE, createSessionToken(kind, id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(safeNext(formData.get("next"), kind));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
