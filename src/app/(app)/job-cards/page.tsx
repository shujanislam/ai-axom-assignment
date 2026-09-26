import type { Metadata } from "next";
import Link from "next/link";
import { Card, Dot, PageHeader, Tag } from "@/components/ui";
import { formatWindow } from "@/lib/booking/slots";
import { jobCardNumber, jobCardStatus } from "@/lib/format";
import { formatRupees } from "@/lib/invoices/pricing";
import { getJobCards, type JobCardScope } from "@/lib/job-cards/queries";

export const metadata: Metadata = { title: "Job cards · gear-ai" };

const scopes: { key: JobCardScope; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "done", label: "Finished" },
  { key: "all", label: "All" },
];

export default async function JobCardsPage({ searchParams }: PageProps<"/job-cards">) {
  const { show } = await searchParams;
  const scope = scopes.find((s) => s.key === show)?.key ?? "open";
  const cards = await getJobCards(scope);
  const unassigned = cards.filter((c) => c.status === "DRAFT").length;

  return (
    <>
      <PageHeader
        title="Job cards"
        subtitle={
          unassigned
            ? `${unassigned} ${unassigned === 1 ? "card needs" : "cards need"} a mechanic`
            : "Created when a visit is booked, with a mechanic, parts and an estimate"
        }
      />

      <nav className="mt-6 flex gap-1.5">
        {scopes.map((s) => (
          <Link
            key={s.key}
            href={s.key === "open" ? "/job-cards" : `/job-cards?show=${s.key}`}
            aria-current={s.key === scope ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-[13.5px] transition-colors ${
              s.key === scope ? "bg-ink text-white" : "bg-white text-muted hover:text-ink"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <Card className="mt-3.5 overflow-x-auto px-6 pb-4 pt-4">
        <table className="w-full min-w-[820px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line text-[12.5px] text-muted">
              <th className="px-1 py-4 font-normal">Card</th>
              <th className="px-1 py-4 font-normal">Vehicle</th>
              <th className="px-1 py-4 font-normal">Job</th>
              <th className="px-1 py-4 font-normal">Mechanic</th>
              <th className="px-1 py-4 font-normal">When</th>
              <th className="px-1 py-4 text-right font-normal">Estimate</th>
              <th className="px-1 py-4 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => {
              const status = jobCardStatus[c.status];
              return (
                <tr key={c.id} className="border-b border-line last:border-0">
                  <td className="px-1 py-[17px]">
                    <Link href={`/job-cards/${c.id}`} className="font-semibold hover:underline">
                      {jobCardNumber(c.id)}
                    </Link>
                  </td>
                  <td className="px-1 py-[17px] text-muted">
                    <span className="text-ink">{c.vehicle_number}</span> · {c.customer_name}
                  </td>
                  <td className="px-1 py-[17px]">
                    {c.title}
                    <span className="ml-2 inline-flex gap-1.5">
                      <Tag>{c.skill_label}</Tag>
                      {c.parts_short && <Tag className="bg-amber-soft text-amber-ink">Parts to order</Tag>}
                    </span>
                  </td>
                  <td className="px-1 py-[17px] text-muted">{c.mechanic_name ?? "Unassigned"}</td>
                  <td className="px-1 py-[17px] text-muted tabular">{formatWindow(c.starts_at, c.ends_at)}</td>
                  <td className="px-1 py-[17px] text-right tabular">{formatRupees(c.total)}</td>
                  <td className="px-1 py-[17px]">
                    <span className="flex items-center gap-2 text-muted">
                      <Dot tone={status.tone} />
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {cards.length === 0 && (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted">
                  {scope === "open" ? "No open job cards. They appear here when a visit is booked." : "No job cards."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
