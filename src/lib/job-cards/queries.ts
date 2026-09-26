import "server-only";
import type { AdvisorAction, Priority } from "@/lib/format";
import { sql } from "@/lib/db";

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

export type JobCardSummary = {
  vehicle_number: string;
  vehicle_type: string | null;
  customer_name: string | null;
  pending: number;
  on_card: number;
  latest_at: Date;
};

export async function getJobCards() {
  const rows = await sql`
    SELECT v.vehicle_number, v.vehicle_type, c.name AS customer_name,
      count(*) FILTER (WHERE r.advisor_action = 'PENDING')::int AS pending,
      count(*) FILTER (WHERE r.advisor_action IN ('APPROVED', 'SCHEDULE_SERVICE', 'COMPLETED'))::int AS on_card,
      max(r.created_at) AS latest_at
    FROM recommendations r
    JOIN vehicles v ON v.id = r.vehicle_id
    JOIN customers c ON c.id = r.customer_id
    WHERE r.source = 'WORKSHOP'
    GROUP BY v.vehicle_number, v.vehicle_type, c.name
    ORDER BY max(r.created_at) DESC`;
  return rows as JobCardSummary[];
}
