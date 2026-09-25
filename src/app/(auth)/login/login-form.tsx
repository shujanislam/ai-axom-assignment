"use client";

import { useActionState, useState, type ReactNode } from "react";
import { ArrowRightIcon } from "@/components/icons";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
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
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} noValidate className="mt-7 space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <Field id="username" label="Username" error={errors.username}>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          defaultValue={state.username}
          aria-invalid={!!errors.username}
          aria-describedby={errors.username ? "username-error" : undefined}
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
          placeholder="e.g. rahul.sharma"
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
