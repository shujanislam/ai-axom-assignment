// Instant, deterministic follow-ups: next service dates set at the last visit, and service intervals.
import { formatDate, type Priority } from "@/lib/format";
import { TITLE_MAX, type Candidate, type VehicleContext } from "./context";

/** Service intervals the workshop follows. A vehicle is only checked for a kind it has had before. */
const SERVICE_RULES = [
  { title: "Periodic service", type: "SERVICE", label: "periodic service", months: 12, match: /periodic/i },
  { title: "AC service", type: "SERVICE", label: "AC service", months: 12, match: /\bac\b|air.?con/i },
  { title: "Brake inspection", type: "INSPECTION", label: "brake service", months: 12, match: /brake/i },
  { title: "Battery health check", type: "INSPECTION", label: "battery check", months: 12, match: /battery/i },
] as const;

type Rule = (typeof SERVICE_RULES)[number];

/** Which rule a visit or appointment belongs to, judged by its service name (the part before "·"). */
function ruleFor(text: string): Rule | undefined {
  const name = text.split("·")[0];
  return SERVICE_RULES.find((r) => r.match.test(name));
}

export function todayInIndia() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

function monthsBetween(from: string, to: string) {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

function overduePriority(monthsOver: number): Priority {
  if (monthsOver < 0) return "LOW"; // due within the month
  if (monthsOver < 3) return "MEDIUM";
  if (monthsOver < 6) return "HIGH";
  return "URGENT";
}

/** Services not yet booked or suggested for this vehicle, by rule title. */
function alreadyPlanned(v: VehicleContext) {
  return new Set(
    [...v.open_appointments.map((a) => a.type), ...v.pending_follow_ups]
      .map((t) => ruleFor(t)?.title ?? t)
      .map((t) => t.toLowerCase()),
  );
}

/** Vehicles whose next service date (set at the last visit) is this close, or already past, come back. */
const NEXT_DUE_WINDOW_DAYS = 30;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function nextDuePriority(daysLeft: number): Priority {
  if (daysLeft < -30) return "URGENT";
  if (daysLeft < 0) return "HIGH";
  if (daysLeft <= 7) return "MEDIUM";
  return "LOW";
}

/** Follow-ups from services.next_appointment_date: the date the workshop set at the last visit. */
export function evaluateNextDue(vehicles: VehicleContext[], today: string): Candidate[] {
  return vehicles.flatMap((v) => {
    if (!v.next_due) return [];
    const daysLeft = daysBetween(today, v.next_due.date);
    if (daysLeft > NEXT_DUE_WINDOW_DAYS) return [];

    const name = v.next_due.service.split("·")[0].trim();
    const rule = ruleFor(name);
    const title = (rule?.title ?? name) || "Periodic service";
    if (alreadyPlanned(v).has(title.toLowerCase())) return [];

    const when =
      daysLeft > 1
        ? `in ${daysLeft} days`
        : daysLeft === 1
          ? "tomorrow"
          : daysLeft === 0
            ? "today"
            : `${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago`;
    return [
      {
        customer_id: v.customer_id,
        vehicle_id: v.vehicle_id,
        vehicle_number: v.vehicle_number,
        recommendation_type: rule?.type ?? "SERVICE",
        title: title.slice(0, TITLE_MAX),
        description: `Next service was set for ${formatDate(v.next_due.date)} (${when}) at the visit on ${formatDate(v.next_due.visit)}.`,
        priority: nextDuePriority(daysLeft),
        origin: "next_due" as const,
      },
    ];
  });
}

/** Interval-based follow-ups, worked out in code: instant and deterministic. */
export function evaluateRules(vehicles: VehicleContext[], today: string): Candidate[] {
  return vehicles.flatMap((v) => {
    const planned = alreadyPlanned(v);
    // A next date set at the last visit is the workshop's own plan; it replaces the rule of thumb.
    const plannedByDate = v.next_due ? ruleFor(v.next_due.service) : undefined;
    return SERVICE_RULES.flatMap((rule) => {
      const last = v.completed_visits.find((visit) => ruleFor(visit.service) === rule); // newest first
      if (!last || rule === plannedByDate || planned.has(rule.title.toLowerCase())) return [];

      const months = monthsBetween(last.date, today);
      if (months < rule.months - 1) return [];

      const when = `${months} months ago (${formatDate(last.date)})`;
      return [
        {
          customer_id: v.customer_id,
          vehicle_id: v.vehicle_id,
          recommendation_type: rule.type,
          title: rule.title,
          description:
            months >= rule.months
              ? `Last ${rule.label} was ${when}; it is due every ${rule.months} months.`
              : `Last ${rule.label} was ${when}; it falls due within the next month.`,
          priority: overduePriority(months - rule.months),
        },
      ];
    });
  });
}
