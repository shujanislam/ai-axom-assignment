"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SearchIcon } from "@/components/icons";
import { Button, Card, Dot, PageHeader, type Tone } from "@/components/ui";
import { dueFilters } from "@/lib/format";

export type DueItem = {
  plate: string;
  customer: string;
  vehicleType: string | null;
  appointmentType: string;
  lastService: string | null;
  status: string;
  label: string;
  tone: Tone;
};

type Summary = { label: string; value: number; unit: string; note: string; flagged?: boolean };

type FilterKey = (typeof dueFilters)[number]["key"];

export function ServiceDueView({ today, summary, items }: { today: string; summary: Summary[]; items: DueItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const statuses = dueFilters.find((f) => f.key === filter)?.statuses;
  const q = query.trim().toLowerCase();
  const rows = items.filter(
    (v) =>
      (!statuses || (statuses as readonly string[]).includes(v.status)) &&
      (!q || v.plate.toLowerCase().includes(q) || v.customer.toLowerCase().includes(q)),
  );

  return (
    <>
      <PageHeader
        title="Service due"
        subtitle={`${today} · latest open appointment per vehicle`}
        actions={
          searching ? (
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
          )
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
              <th className="w-[18%] px-1 py-4 font-normal">Vehicle</th>
              <th className="px-1 py-4 font-normal">Customer</th>
              <th className="w-[20%] px-1 py-4 font-normal">Appointment</th>
              <th className="w-[15%] px-1 py-4 font-normal">Last service</th>
              <th className="w-[15%] px-1 py-4 font-normal">State</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr
                key={v.plate}
                onClick={() => router.push(`/vehicles/${v.plate}`)}
                className="cursor-pointer border-b border-line last:border-0 hover:bg-well/60"
              >
                <td className="px-1 py-[17px] font-semibold tracking-[-0.01em]">{v.plate}</td>
                <td className="px-1 py-[17px] text-muted">
                  {v.customer}
                  {v.vehicleType && ` · ${v.vehicleType}`}
                </td>
                <td className="px-1 py-[17px]">{v.appointmentType}</td>
                <td className="px-1 py-[17px] tabular">{v.lastService ?? <span className="text-subtle">None</span>}</td>
                <td className="px-1 py-[17px] text-muted">{v.label}</td>
                <td className="px-1 py-[17px] text-right">
                  <Dot tone={v.tone} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted">
                  {items.length ? "No vehicles match." : "No open appointments."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
