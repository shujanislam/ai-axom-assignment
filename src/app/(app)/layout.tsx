import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { humanize } from "@/lib/format";
import { getCurrentAdvisor } from "@/lib/server/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const advisor = await getCurrentAdvisor();
  if (!advisor) redirect("/login");

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar advisor={{ name: advisor.name, role: humanize(advisor.role) }} />
      <main className="min-w-0 flex-1 px-4 pb-8 pt-6 sm:px-6 lg:py-8 lg:pl-2 lg:pr-9">{children}</main>
    </div>
  );
}
