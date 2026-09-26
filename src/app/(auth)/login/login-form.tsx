"use client";

import { useActionState, useState, type ReactNode } from "react";
import { ArrowRightIcon } from "@/components/icons";
import type { SessionKind } from "@/lib/auth/session";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] text-muted">
        {label}
      </label>
      <div
        className={`mt-1.5 flex h-[46px] items-center rounded-xl bg-well px-4 ring-1 transition-shadow focus-within:bg-white focus-within:ring-ink ${
          error ? "ring-amber" : "ring-transparent"
        }`}
      >
        {children}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[12.5px] text-amber-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const [as, setAs] = useState<SessionKind>(state.as ?? (next?.startsWith("/chat") ? "customer" : "advisor"));
  const errors = state.fieldErrors ?? {};
  const customer = as === "customer";

  return (
    <form action={formAction} noValidate className="mt-7 space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <input type="hidden" name="as" value={as} />

      <div role="radiogroup" aria-label="Sign in as" className="relative grid grid-cols-2 rounded-full bg-well p-1">
        <span
          aria-hidden
          className={`absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white shadow-sm transition-transform duration-200 ${
            customer ? "translate-x-full" : ""
          }`}
        />
        {(["advisor", "customer"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={as === kind}
            onClick={() => setAs(kind)}
            className={`relative z-10 h-9 rounded-full text-[13.5px] transition-colors ${
              as === kind ? "font-medium text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {kind === "advisor" ? "Workshop staff" : "Customer"}
          </button>
        ))}
      </div>

      <Field id="username" label={customer ? "Email" : "Username"} error={errors.username}>
        <input
          id="username"
          name="username"
          type={customer ? "email" : "text"}
          autoComplete={customer ? "email" : "username"}
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          defaultValue={state.username}
          aria-invalid={!!errors.username}
          aria-describedby={errors.username ? "username-error" : undefined}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
          placeholder={customer ? "you@example.com" : "e.g. rahul.sharma"}
        />
      </Field>

      <Field id="password" label="Password" error={errors.password}>
        <input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? "password-error" : undefined}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
          placeholder="••••••••"
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-pressed={showPassword}
          className="-mr-1 shrink-0 rounded-md px-1.5 py-1 text-[12.5px] text-muted hover:text-ink"
        >
          {showPassword ? "Hide" : "Show"}
        </button>
      </Field>

      {state.error && (
        <p role="alert" className="rounded-xl bg-amber-soft px-4 py-3 text-[13px] text-amber-ink">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-2 inline-flex h-[46px] w-full items-center justify-center gap-2.5 rounded-full bg-ink text-[14px] font-medium text-white transition-colors hover:bg-[#34302a] disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
        {!pending && <ArrowRightIcon size={15} />}
      </button>
    </form>
  );
}
