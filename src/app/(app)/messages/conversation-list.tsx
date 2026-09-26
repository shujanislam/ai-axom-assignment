"use client";

import Link from "next/link";
import { useState } from "react";
import { SearchIcon } from "@/components/icons";

export type ConversationItem = {
  id: string;
  name: string;
  initials: string;
  preview: string;
  time: string;
  unanswered: number;
  /** Name, phone and plates, lower-cased, for the search box. */
  search: string;
};

/**
 * `picked` means the chat was chosen explicitly (?c=). Otherwise laptops open the newest chat by
 * default, and only there, so the highlight is laptop-only; on phones nothing is open yet.
 */
export function ConversationList({
  items,
  activeId,
  picked,
}: {
  items: ConversationItem[];
  activeId: string | null;
  picked: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.search.includes(q)) : items;

  return (
    <>
      <div className="px-3 pb-2">
        <label className="flex h-10 items-center gap-2.5 rounded-xl bg-well px-3.5 text-[14px]">
          <SearchIcon size={15} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone or plate"
            aria-label="Search conversations"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle"
          />
        </label>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((i) => {
          const active = i.id === activeId;
          return (
            <li key={i.id}>
              <Link
                href={`/messages?c=${i.id}`}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                  active ? (picked ? "bg-leaf-soft/70" : "hover:bg-well lg:bg-leaf-soft/70") : "hover:bg-well"
                }`}
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#e6e4df] text-[13px] font-semibold text-[#55514b]">
                  {i.initials}
                </span>
                <span className="min-w-0 flex-1 border-b border-line pb-3 pt-1 [li:last-child_&]:border-0">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[14.5px] font-medium">{i.name}</span>
                    <span
                      className={`shrink-0 text-[11.5px] tabular ${i.unanswered ? "font-medium text-amber-ink" : "text-muted"}`}
                    >
                      {i.time}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-3">
                    <span className="truncate text-[13px] text-muted">{i.preview}</span>
                    {i.unanswered > 0 && (
                      <span
                        className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-amber px-1.5 text-[11px] font-semibold text-white"
                        aria-label={`${i.unanswered} unanswered`}
                      >
                        {i.unanswered}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-10 text-center text-[13.5px] text-muted">No chats match.</li>}
      </ul>
    </>
  );
}
