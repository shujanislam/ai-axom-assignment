import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, Tag } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { getJobCards } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Job cards · Servicedesk" };

export default async function JobCardsPage() {
  const cards = await getJobCards();

  return (
    <>
      <PageHeader title="Job cards" subtitle="One card per vehicle, built from reviewed suggestions" />

      <Card className="mt-6 overflow-x-auto px-6 pb-4 pt-4">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line text-[12.5px] text-muted">
              <th className="px-1 py-4 font-normal">Card</th>
              <th className="px-1 py-4 font-normal">Customer</th>
              <th className="px-1 py-4 font-normal">On the card</th>
              <th className="px-1 py-4 font-normal">To review</th>
              <th className="px-1 py-4 font-normal">Latest suggestion</th>
              <th className="px-1 py-4" />
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.vehicle_number} className="border-b border-line last:border-0">
                <td className="px-1 py-[17px]">
                  <Link href={`/job-cards/${c.vehicle_number}`} className="font-semibold hover:underline">
                    JC-{c.vehicle_number}
                  </Link>
                </td>
                <td className="px-1 py-[17px] text-muted">
                  {c.customer_name}
                  {c.vehicle_type && ` · ${c.vehicle_type}`}
                </td>
                <td className="px-1 py-[17px] tabular">{c.on_card}</td>
                <td className="px-1 py-[17px]">{c.pending > 0 ? <Tag>{c.pending} open</Tag> : <span className="text-subtle">None</span>}</td>
                <td className="px-1 py-[17px] text-muted tabular">{formatDate(c.latest_at)}</td>
                <td className="px-1 py-[17px] text-right">
                  <Link href={`/job-cards/${c.vehicle_number}/review`} className="text-[13.5px] text-muted hover:text-ink">
                    Review →
                  </Link>
                </td>
              </tr>
            ))}
            {cards.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted">
                  No suggestions have been raised yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
