import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, Tag } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { getAcceptanceStats, getRecommendations } from "@/lib/job-cards/queries";
import { getServiceHistory, getVehicle } from "@/lib/vehicles/queries";
import { AddObservation, SuggestionList } from "./suggestion-list";

export const metadata: Metadata = { title: "Suggestions · gear-ai" };

const wordingRules = {
  body: "Every line reaches the workshop as an inspection instruction. No fault is named until the technician confirms it, and no part is priced until the customer approves the estimate.",
  tags: ["Possible", "Recommended inspection", "Based on history", "Needs verification"],
};

const barShades = ["#dfe6d6", "#d6dfca", "#cdd8bf", "#b9cba5", "#a9c192", "#6a9c3f", "#5b9234"];

export default async function ReviewPage({ params }: PageProps<"/job-cards/[plate]/review">) {
  const plate = decodeURIComponent((await params).plate);
  const vehicle = await getVehicle(plate);
  if (!vehicle) notFound();

  const [recommendations, services, stats] = await Promise.all([
    getRecommendations(vehicle.id),
    getServiceHistory(vehicle.id),
    getAcceptanceStats(),
  ]);
  const max = Math.max(1, ...stats.daily);

  return (
    <SuggestionList
      plate={vehicle.vehicle_number}
      subtitle={`${vehicle.vehicle_number} · drawn from ${services.length} past visits · nothing is confirmed until you accept it`}
      recommendations={recommendations.map((r) => ({
        id: r.id,
        type: r.recommendation_type,
        title: r.title,
        description: r.description,
        priority: r.priority,
        action: r.advisor_action,
        advisorName: r.advisor_name,
        createdAt: formatDate(r.created_at),
      }))}
      aside={
        <aside className="space-y-3.5">
          <h2 className="text-[14px] text-muted">Your additions</h2>
          <AddObservation plate={vehicle.vehicle_number} />

          <Card className="p-6">
            <h3 className="text-[14px] text-muted">Wording rules</h3>
            <p className="mt-3 text-[13.5px] leading-[1.6]">{wordingRules.body}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {wordingRules.tags.map((t) => (
                <Tag key={t} className="px-2.5 py-1 text-[12.5px]">
                  {t}
                </Tag>
              ))}
            </div>
          </Card>

          <Card className="flex items-end justify-between gap-4 p-6">
            <div>
              <p className="text-[12px] text-muted">Accepted of those reviewed, last 7 days</p>
              <p className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.04em]">
                {stats.rate === null ? "—" : `${stats.rate}%`}
              </p>
            </div>
            <div className="flex h-12 items-end gap-[5px]" aria-hidden>
              {stats.daily.map((v, i) => (
                <span
                  key={i}
                  className="w-[18px] rounded-[3px]"
                  style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: barShades[i] }}
                />
              ))}
            </div>
          </Card>
        </aside>
      }
    />
  );
}
