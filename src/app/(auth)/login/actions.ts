"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyCredentials } from "@/lib/server/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export type LoginState = {
  error?: string;
  fieldErrors?: { username?: string; password?: string };
  username?: string;
};

/** Only same-site relative paths, so ?next= can't bounce users off-site. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/service-due";
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const fieldErrors: LoginState["fieldErrors"] = {};
  if (!username) fieldErrors.username = "Enter your username";
  if (!password) fieldErrors.password = "Enter your password";
  if (fieldErrors.username || fieldErrors.password) return { fieldErrors, username };

  const advisor = await verifyCredentials(username, password);
  if (!advisor || advisor.role === "CUSTOMER") {
    return { error: "That username and password don’t match.", username };
  }

  (await cookies()).set(SESSION_COOKIE, createSessionToken(advisor.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(safeNext(formData.get("next")));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
