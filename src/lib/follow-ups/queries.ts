import "server-only";
import type { Priority } from "@/lib/format";
import { sql } from "@/lib/db";

export type FollowUpRow = {
  id: string;
  source: "FOLLOW_UP" | "CHAT";
  recommendation_type: string;
  title: string;
  description: string | null;
  priority: Priority;
  created_at: Date;
  vehicle_number: string;
  vehicle_type: string | null;
  customer_name: string;
  phone_number: string;
  preferred_language: string | null;
  last_service_at: Date | null;
};

/** Follow-up recommendations from the Re-evaluate job that are waiting for an advisor. */
export async function getPendingFollowUps() {
  const rows = await sql`
    SELECT r.id, r.source, r.recommendation_type, r.title, r.description, r.priority, r.created_at,
      v.vehicle_number, v.vehicle_type, c.name AS customer_name, c.phone_number, c.preferred_language,
      GREATEST(
        (SELECT max(s.created_at) FROM services s WHERE s.vehicle_id = v.id),
        (SELECT max(a.created_at) FROM appointments a WHERE a.vehicle_id = v.id AND a.status = 'COMPLETED')
      ) AS last_service_at
    FROM recommendations r
    JOIN vehicles v ON v.id = r.vehicle_id
    JOIN customers c ON c.id = r.customer_id
    WHERE r.source IN ('FOLLOW_UP', 'CHAT') AND r.advisor_action = 'PENDING'
    ORDER BY
      CASE r.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
      r.created_at DESC`;
  return rows as FollowUpRow[];
}

/** Follow-ups approved into DUE appointments. */
export async function countApprovedFollowUps() {
  const [row] = await sql`
    SELECT count(*)::int AS n FROM recommendations WHERE source IN ('FOLLOW_UP', 'CHAT') AND advisor_action = 'APPROVED'`;
  return (row as { n: number }).n;
}
