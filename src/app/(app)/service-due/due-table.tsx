"use client";

import { Fragment, useState, useTransition } from "react";
import { CheckIcon, SearchIcon } from "@/components/icons";
import { Button, ButtonLink, Card, Dot, PageHeader, Row, Tag, type Tone } from "@/components/ui";
import { dueFilters, humanize, priorityLevel, type Priority } from "@/lib/format";
import { approveFollowUp, type ApproveResult } from "./actions";
import { ReevaluateButton } from "./reevaluate-button";

export type DueItem = {
  id: string;
  fromChat: boolean;
  plate: string;
  customer: string;
  phone: string;
  language: string | null;
  vehicleType: string | null;
  type: string;
  title: string;
  description: string | null;
  priority: Priority;
  raised: string;
  lastService: string | null;
};

type Summary = { label: string; value: number; unit: string; note: string; flagged?: boolean };

type FilterKey = (typeof dueFilters)[number]["key"];

const priorityTone: Record<Priority, Tone> = { URGENT: "amber", HIGH: "amber", MEDIUM: "idle", LOW: "idle" };

export function ServiceDueView({ today, summary, items }: { today: string; summary: Summary[]; items: DueItem[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ApproveResult | null>(null);

  const priorities = dueFilters.find((f) => f.key === filter)?.priorities;
  const q = query.trim().toLowerCase();
  const rows = items.filter(
    (v) =>
      (!priorities || (priorities as readonly string[]).includes(v.priority)) &&
      (!q || v.plate.toLowerCase().includes(q) || v.customer.toLowerCase().includes(q)),
  );

  return (
    <>
      <PageHeader
        title="Service due"
        subtitle={`${today} · follow-ups from completed visits and customer chats`}
        actions={
          <>
            <ReevaluateButton />
            {searching ? (
              <label className="flex h-[46px] w-60 items-center gap-2.5 rounded-full bg-white px-5 text-[14px]">
                <SearchIcon size={15} />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => !query && setSearching(false)}
                  placeholder="Plate or customer"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-subtle"
                />
              </label>
            ) : (
              <Button variant="secondary" onClick={() => setSearching(true)} className="flex-row-reverse">
                Search
                <SearchIcon size={15} />
              </Button>
            )}
          </>
        }
      />

      <div className="mt-6 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.label} className="relative px-6 pb-6 pt-7">
            {s.flagged && <Dot tone="amber" className="absolute right-6 top-7" />}
            <p className="text-[13px] text-muted">{s.label}</p>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="text-[34px] font-semibold leading-none tracking-[-0.04em] tabular">{s.value}</span>
              <span className="text-[15px] text-muted">{s.unit}</span>
            </p>
            <p className="mt-3 text-[12px] text-muted">{s.note}</p>
          </Card>
        ))}
      </div>

      {notice && (
        <p role="status" className="mt-6 flex items-center gap-2.5 rounded-[14px] bg-white px-5 py-3.5 text-[13.5px]">
          <Dot tone={notice.emailed ? "leaf" : "amber"} />
          {notice.emailed
            ? `Approved. ${notice.customer} has been emailed a link to pick a slot.`
            : `Approved and saved as due, but no email was sent to ${notice.customer}: ${notice.reason}.`}
        </p>
      )}

      <div role="tablist" className="mt-6 flex gap-1 overflow-x-auto">
        {dueFilters.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-4 py-2 text-[14px] transition-colors ${
              filter === f.key ? "bg-white font-medium text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card className="mt-5 overflow-x-auto px-6 pb-4 pt-4">
        <table className="w-full min-w-[720px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line text-[12.5px] text-muted">
              <th className="w-[16%] px-1 py-4 font-normal">Vehicle</th>
              <th className="px-1 py-4 font-normal">Customer</th>
              <th className="w-[26%] px-1 py-4 font-normal">Recommended service</th>
              <th className="w-[14%] px-1 py-4 font-normal">Last service</th>
              <th className="w-[12%] px-1 py-4 font-normal">Priority</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const open = openId === v.id;
              return (
                <Fragment key={v.id}>
                  <tr
                    onClick={() => setOpenId(open ? null : v.id)}
                    aria-expanded={open}
                    className={`cursor-pointer border-b border-line hover:bg-well/60 ${open ? "bg-well/60" : ""}`}
                  >
                    <td className="px-1 py-[17px] font-semibold tracking-[-0.01em]">{v.plate}</td>
                    <td className="px-1 py-[17px] text-muted">
                      {v.customer}
                      {v.vehicleType && ` · ${v.vehicleType}`}
                    </td>
                    <td className="px-1 py-[17px]">
                      {v.title}
                      {v.fromChat && <Tag className="ml-2">From chat</Tag>}
                    </td>
                    <td className="px-1 py-[17px] tabular">
                      {v.lastService ?? <span className="text-subtle">None</span>}
                    </td>
                    <td className="px-1 py-[17px] text-muted">{humanize(v.priority)}</td>
                    <td className="px-1 py-[17px] text-right">
                      <Dot tone={priorityTone[v.priority]} />
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-line">
                      <td colSpan={6} className="px-1 pb-6 pt-4">
                        <FollowUpDetail
                          item={v}
                          onDone={(result) => {
                            setOpenId(null);
                            setNotice(result);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted">
                  {items.length ? "No recommendations match." : "No follow-ups to review. Try Re-evaluate."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function FollowUpDetail({ item, onDone }: { item: DueItem; onDone: (result: ApproveResult) => void }) {
  const [approving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div>
        <p className="text-[15px] font-semibold tracking-[-0.01em]">{item.title}</p>
        <p className="mt-1.5 max-w-prose text-[13.5px] leading-relaxed text-muted">
          {item.description ?? "No details from the evaluation."}
        </p>
        <div className="mt-5 flex max-w-sm items-center gap-4">
          <div className="h-[3px] flex-1 rounded-full bg-line">
            <div className="h-full rounded-full bg-amber" style={{ width: `${priorityLevel[item.priority]}%` }} />
          </div>
          <span className="shrink-0 text-[12px] text-muted">{humanize(item.priority)} priority</span>
        </div>
      </div>

      <div>
        <dl className="border-b border-line pb-3">
          <Row label="Type" value={humanize(item.type)} dense />
          <Row label="Phone" value={item.phone} dense />
          <Row label="Language" value={item.language ?? "Not set"} dense />
          <Row label="Raised" value={item.raised} dense />
        </dl>
        <div className="mt-4 flex items-center justify-end gap-2.5">
          <ButtonLink variant="outline" href={`/vehicles/${item.plate}`}>
            View vehicle
          </ButtonLink>
          <Button
            className="h-9 px-4 text-[13.5px]"
            disabled={approving}
            icon={<CheckIcon size={14} />}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                try {
                  onDone(await approveFollowUp(item.id));
                } catch {
                  setError("Could not approve. It may already be handled; reload to check.");
                }
              })
            }
          >
            {approving ? "Approving…" : "Approve"}
          </Button>
        </div>
        {error && <p className="mt-2 text-right text-[12.5px] text-amber">{error}</p>}
      </div>
    </div>
  );
}
