import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { logout } from "@/app/(auth)/login/actions";
import { SparkIcon } from "@/components/icons";
import { getCurrentCustomer } from "@/lib/auth/accounts";

export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const customer = await getCurrentCustomer();
  // A signed cookie for a customer who no longer exists: clear it, or /login bounces back here.
  if (!customer) redirect("/session-expired");

  return (
    <div className="mx-auto flex min-h-screen max-w-[760px] flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <span className="flex items-center gap-2.5">
          <span className="grid size-[30px] place-items-center rounded-[9px] bg-ink text-white">
            <SparkIcon size={15} strokeWidth={1.8} />
          </span>
          <span className="text-[15px] font-semibold italic tracking-[-0.02em]">gear-ai</span>
        </span>
        <span className="flex items-center gap-3 text-[13px] text-muted">
          {customer.name}
          <form action={logout}>
            <button type="submit" className="rounded-md px-1.5 py-1 text-[12px] hover:bg-white/60 hover:text-ink">
              Sign out
            </button>
          </form>
        </span>
      </header>
      <main className="flex flex-1 flex-col pb-6">{children}</main>
    </div>
  );
}
