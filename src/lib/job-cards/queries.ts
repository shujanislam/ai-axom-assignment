import "server-only";
import { openJobCardStatuses, type AdvisorAction, type JobCardStatus, type Priority } from "@/lib/format";
import type { InvoiceCost } from "@/lib/invoices/pricing";
import { sql } from "@/lib/db";
import { mechanicIsFree, type JobPart } from "./plan";

export type RecommendationRow = {
  id: string;
  recommendation_type: string;
  title: string;
  description: string | null;
  priority: Priority;
  advisor_action: AdvisorAction;
  advisor_name: string | null;
  created_at: Date;
};

export async function getRecommendations(vehicleId: string) {
  const rows = await sql`
    SELECT r.id, r.recommendation_type, r.title, r.description, r.priority, r.advisor_action,
      adv.name AS advisor_name, r.created_at
    FROM recommendations r
    LEFT JOIN advisors adv ON adv.id = r.advisor_id
    WHERE r.vehicle_id = ${vehicleId} AND r.source = 'WORKSHOP'
    ORDER BY
      CASE r.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
      r.created_at`;
  return rows as RecommendationRow[];
}

/**
 * Of the recommendations raised in the last 7 days that have been reviewed,
 * the share accepted, plus accepted counts per day (oldest first).
 */
export async function getAcceptanceStats() {
  const rows = await sql`
    SELECT d::date AS day,
      count(r.id) FILTER (WHERE r.advisor_action IN ('APPROVED', 'SCHEDULE_SERVICE', 'COMPLETED'))::int AS accepted,
      count(r.id) FILTER (WHERE r.advisor_action <> 'PENDING')::int AS reviewed
    FROM generate_series(current_date - 6, current_date, interval '1 day') d
    LEFT JOIN recommendations r ON r.created_at::date = d::date AND r.source = 'WORKSHOP'
    GROUP BY d ORDER BY d`;
  const days = rows as { day: Date; accepted: number; reviewed: number }[];
  const accepted = days.reduce((n, d) => n + d.accepted, 0);
  const reviewed = days.reduce((n, d) => n + d.reviewed, 0);
  return { rate: reviewed ? Math.round((accepted / reviewed) * 100) : null, daily: days.map((d) => d.accepted) };
}

// -------------------------------------------------------------- job cards

export type JobCardScope = "open" | "done" | "all";

export type JobCardSummary = {
  id: string;
  status: JobCardStatus;
  title: string;
  skill_label: string;
  starts_at: Date;
  ends_at: Date;
  mechanic_name: string | null;
  parts_short: boolean;
  total: number;
  vehicle_number: string;
  vehicle_type: string | null;
  customer_name: string;
};

/** Open cards soonest first; finished ones newest first. */
export async function getJobCards(scope: JobCardScope) {
  const rows = await sql`
    SELECT j.id, j.status, j.title, sc.label AS skill_label, j.starts_at, j.ends_at, m.name AS mechanic_name,
      j.parts_short, (j.estimate->>'total')::int AS total, v.vehicle_number, v.vehicle_type, c.name AS customer_name
    FROM job_cards j
    JOIN service_catalog sc ON sc.skill = j.skill
    JOIN vehicles v ON v.id = j.vehicle_id
    JOIN customers c ON c.id = j.customer_id
    LEFT JOIN mechanics m ON m.id = j.mechanic_id
    WHERE ${scope} = 'all' OR (j.status = ANY(${openJobCardStatuses})) = (${scope} = 'open')
    ORDER BY CASE WHEN ${scope} = 'open' THEN j.starts_at END, j.starts_at DESC`;
  return rows as JobCardSummary[];
}

export type JobCardDetail = JobCardSummary & {
  appointment_id: string;
  appointment_status: string;
  invoice_id: string | null;
  vehicle_id: string;
  skill: string;
  labour_hours: number;
  mechanic_id: string | null;
  mechanic_phone: string | null;
  customer_phone: string;
  parts: JobPart[];
  estimate: InvoiceCost;
  created_at: Date;
};

export async function getJobCard(id: string) {
  const [row] = await sql`
    SELECT j.id, j.status, j.title, j.skill, sc.label AS skill_label, sc.labour_hours, j.starts_at, j.ends_at,
      j.mechanic_id, m.name AS mechanic_name, m.phone_number AS mechanic_phone,
      j.parts, j.parts_short, j.estimate, (j.estimate->>'total')::int AS total, j.created_at,
      j.appointment_id, a.status AS appointment_status,
      (SELECT i.id FROM invoices i WHERE i.appointment_id = a.id ORDER BY i.created_at DESC LIMIT 1) AS invoice_id,
      v.id AS vehicle_id, v.vehicle_number, v.vehicle_type, c.name AS customer_name, c.phone_number AS customer_phone
    FROM job_cards j
    JOIN service_catalog sc ON sc.skill = j.skill
    JOIN appointments a ON a.id = j.appointment_id
    JOIN vehicles v ON v.id = j.vehicle_id
    JOIN customers c ON c.id = j.customer_id
    LEFT JOIN mechanics m ON m.id = j.mechanic_id
    WHERE j.id = ${id}`;
  return (row as JobCardDetail | undefined) ?? null;
}

export type MechanicOption = { id: string; name: string; level: number; free: boolean; current: boolean };

/** Everyone with the card's skill, and whether they are free for its whole time. */
export async function getMechanicOptions(jobCardId: string) {
  const rows = await sql`
    SELECT m.id, m.name, ms.level, j.mechanic_id IS NOT DISTINCT FROM m.id AS current,
      (${mechanicIsFree()}) AS free
    FROM job_cards j
    CROSS JOIN LATERAL (SELECT j.starts_at, j.ends_at, j.skill) w
    JOIN mechanic_skills ms ON ms.skill = j.skill
    JOIN mechanics m ON m.id = ms.mechanic_id AND m.active
    WHERE j.id = ${jobCardId}
    ORDER BY ms.level DESC, m.name`;
  return rows as MechanicOption[];
}

/** The vehicle's most recent job card, for linking from the vehicle page. */
export async function getLatestJobCardId(vehicleId: string) {
  const [row] = await sql`
    SELECT id FROM job_cards WHERE vehicle_id = ${vehicleId} ORDER BY created_at DESC LIMIT 1`;
  return (row?.id as string | undefined) ?? null;
}
