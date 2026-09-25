"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  CalendarIcon,
  CardIcon,
  ChatIcon,
  HomeIcon,
  ListIcon,
  SparkIcon,
} from "./icons";
import { logout } from "@/app/(auth)/login/actions";
import { initials } from "@/lib/format";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  match: (path: string) => boolean;
};

const nav: NavItem[] = [
  { href: "/today", label: "Today", icon: HomeIcon, match: (p) => p.startsWith("/today") || p.startsWith("/vehicles") },
  { href: "/service-due", label: "Service due", icon: ListIcon, match: (p) => p.startsWith("/service-due") },
  { href: "/messages", label: "Messages", icon: ChatIcon, match: (p) => p.startsWith("/messages") },
  { href: "/appointments", label: "Appointments", icon: CalendarIcon, match: (p) => p.startsWith("/appointments") },
  { href: "/job-cards", label: "Job cards", icon: CardIcon, match: (p) => p.startsWith("/job-cards") },
];

export function Sidebar({ advisor }: { advisor: { name: string; role: string } }) {
  const pathname = usePathname();

  return (
    <aside className="flex shrink-0 flex-col px-4 pt-6 lg:sticky lg:top-0 lg:h-screen lg:w-[232px] lg:px-5 lg:pb-6 lg:pt-7">
      <Link href="/service-due" className="flex items-center gap-2.5 px-2 lg:px-2.5">
        <span className="grid size-[30px] place-items-center rounded-[9px] bg-ink text-white">
          <SparkIcon size={15} strokeWidth={1.8} />
        </span>
        <span className="text-[15px] font-semibold italic tracking-[-0.02em]">Servicedesk</span>
      </Link>

      <nav className="mt-4 flex gap-1 overflow-x-auto lg:mt-8 lg:flex-col lg:gap-[5px] lg:overflow-visible">
        {nav.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors lg:px-3.5 ${
                active
                  ? "bg-white font-medium text-ink"
                  : "text-muted hover:bg-white/50 hover:text-ink"
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 flex items-center gap-2.5 px-2 lg:mt-auto">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#e6e4df] text-[11px] font-semibold text-[#55514b]">
          {initials(advisor.name)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[12.5px] font-medium">{advisor.name}</span>
          <span className="block text-[11px] text-muted">{advisor.role}</span>
        </span>
        <form action={logout}>
          <button type="submit" className="rounded-md px-1.5 py-1 text-[11.5px] text-muted hover:bg-white/60 hover:text-ink">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
