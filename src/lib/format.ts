import type { Tone } from "@/components/ui";

// ------------------------------------------------------------- appointments

/** appointments.status is free text; these are the values the desk understands. */
export const appointmentStatus: Record<string, { label: string; tone: Tone }> = {
  CHECKED_IN: { label: "Here now", tone: "leaf" },
  SCHEDULED: { label: "Booked", tone: "leaf" },
  OVERDUE: { label: "Overdue", tone: "amber" },
  MISSED: { label: "Missed slot", tone: "amber" },
  NO_REPLY: { label: "No reply", tone: "idle" },
  PAUSED: { label: "Paused", tone: "idle" },
  DECLINED: { label: "Declined", tone: "idle" },
  DUE: { label: "Due", tone: "idle" },
  COMPLETED: { label: "Completed", tone: "idle" },
  CANCELLED: { label: "Cancelled", tone: "idle" },
};

export function statusMeta(status: string) {
  return appointmentStatus[status] ?? { label: humanize(status), tone: "idle" as Tone };
}

export const dueFilters = [
  { key: "all", label: "All", priorities: null },
  { key: "urgent", label: "Urgent", priorities: ["URGENT"] },
  { key: "high", label: "High", priorities: ["HIGH"] },
  { key: "medium", label: "Medium", priorities: ["MEDIUM"] },
  { key: "low", label: "Low", priorities: ["LOW"] },
] as const;

// ---------------------------------------------------------- recommendations

export type AdvisorAction =
  | "PENDING"
  | "CONTACT_CUSTOMER"
  | "SCHEDULE_SERVICE"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED"
  | "NO_ACTION";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export const recommendationTypes = [
  "SERVICE",
  "MAINTENANCE",
  "REPAIR",
  "PART_REPLACEMENT",
  "INSPECTION",
  "UPGRADE",
  "OTHER",
] as const;

export const priorities: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

/** Share of the bar filled for each priority. */
export const priorityLevel: Record<Priority, number> = { LOW: 25, MEDIUM: 50, HIGH: 75, URGENT: 100 };

export const actionLabel: Record<AdvisorAction, string> = {
  PENDING: "Suggested",
  CONTACT_CUSTOMER: "Contact customer",
  SCHEDULE_SERVICE: "Sent to workshop",
  APPROVED: "Accepted",
  REJECTED: "Ignored",
  COMPLETED: "Completed",
  NO_ACTION: "No action",
};

/** Actions that put a recommendation on the job card. */
export const onJobCard: AdvisorAction[] = ["APPROVED", "SCHEDULE_SERVICE", "COMPLETED"];

// ------------------------------------------------------------------ helpers

export function humanize(value: string) {
  const text = value.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function daysSince(value: Date | string) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
}

/** Services are stored as "Title · detail, detail". */
export function splitServiceType(serviceType: string) {
  const [title, ...rest] = serviceType.split(" · ");
  return { title, detail: rest.join(" · ") };
}

/** Pick the blueprint body for a vehicles.vehicle_type value. */
export function bodyTypeFor(vehicleType: string | null): "sedan" | "suv" | "hatch" {
  const type = (vehicleType ?? "").toLowerCase();
  if (type.includes("suv")) return "suv";
  if (type.includes("hatch")) return "hatch";
  return "sedan";
}
