import type { Metadata } from "next";
import { formatDate } from "@/lib/format";
import { countApprovedFollowUps, getPendingFollowUps } from "@/lib/follow-ups/queries";
import { ServiceDueView, type DueItem } from "./due-table";

export const metadata: Metadata = { title: "Service due · gear-ai" };

export default async function ServiceDuePage() {
  const [rows, approved] = await Promise.all([getPendingFollowUps(), countApprovedFollowUps()]);

  const items: DueItem[] = rows.map((r) => ({
    id: r.id,
    fromChat: r.source === "CHAT",
    plate: r.vehicle_number,
    customer: r.customer_name,
    phone: r.phone_number,
    language: r.preferred_language,
    vehicleType: r.vehicle_type,
    type: r.recommendation_type,
    title: r.title,
    description: r.description,
    priority: r.priority,
    raised: formatDate(r.created_at),
    lastService: r.last_service_at ? formatDate(r.last_service_at) : null,
  }));

  const urgent = rows.filter((r) => r.priority === "URGENT" || r.priority === "HIGH").length;
  const owners = new Set(rows.map((r) => r.customer_name)).size;

  const summary = [
    { label: "To review", value: rows.length, unit: "services", note: "From completed visits and chat" },
    {
      label: "High priority",
      value: urgent,
      unit: "services",
      note: urgent ? "Urgent or high, call first" : "Nothing pressing",
      flagged: urgent > 0,
    },
    { label: "Owners", value: owners, unit: "customers", note: "To contact about a visit" },
    { label: "Approved", value: approved, unit: "services", note: "Booked as due appointments" },
  ];

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  return <ServiceDueView today={today} summary={summary} items={items} />;
}
