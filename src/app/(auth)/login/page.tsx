import type { Metadata } from "next";
import { SparkIcon } from "@/components/icons";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Servicedesk" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center justify-center gap-2.5">
          <span className="grid size-[34px] place-items-center rounded-[10px] bg-ink text-white">
            <SparkIcon size={17} strokeWidth={1.8} />
          </span>
          <span className="text-[17px] font-semibold italic tracking-[-0.02em]">Servicedesk</span>
        </div>

        <section className="mt-8 rounded-[20px] bg-white px-7 pb-7 pt-8">
          <h1 className="text-[26px] font-bold italic leading-tight tracking-[-0.03em]">Sign in</h1>
          <p className="mt-1 text-[13.5px] text-muted">Use your workshop account to open today’s desk.</p>
          <LoginForm next={typeof next === "string" ? next : undefined} />
        </section>

        <p className="mt-6 text-center text-[12px] text-muted">
          Trouble signing in? Ask your workshop manager to reset your account.
        </p>
      </div>
    </main>
  );
}
