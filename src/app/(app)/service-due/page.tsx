import type { Metadata } from "next";
import { daysSince, formatDate, statusMeta } from "@/lib/format";
import { getServiceDue } from "@/lib/server/queries";
import { ServiceDueView, type DueItem } from "./due-table";

export const metadata: Metadata = { title: "Service due · Servicedesk" };

export default async function ServiceDuePage() {
  const rows = await getServiceDue();

  const items: DueItem[] = rows.map((r) => ({
    plate: r.vehicle_number,
    customer: r.customer_name,
    vehicleType: r.vehicle_type,
    appointmentType: r.appointment_type,
    lastService: r.last_service_at ? formatDate(r.last_service_at) : null,
    status: r.status,
    ...statusMeta(r.status),
  }));

  const count = (...statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).length;
  const overdue = rows.filter((r) => r.status === "OVERDUE");
  const oldest = overdue.length ? Math.max(...overdue.map((r) => daysSince(r.created_at))) : 0;
  const hereNow = count("CHECKED_IN");

  const summary = [
    { label: "Open", value: rows.length, unit: "vehicles", note: "Latest open appointment each" },
    {
      label: "Overdue",
      value: overdue.length,
      unit: "vehicles",
      note: overdue.length ? `Oldest is ${oldest} days past` : "Nothing overdue",
      flagged: overdue.length > 0,
    },
    { label: "Waiting on a reply", value: count("NO_REPLY"), unit: "customers", note: "Reminder sent, no answer yet" },
    { label: "Booked", value: count("SCHEDULED", "CHECKED_IN"), unit: "vehicles", note: `${hereNow} here now` },
  ];

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  return <ServiceDueView today={today} summary={summary} items={items} />;
}
