// What the follow-up job works from (every vehicle with a finished visit) and how it saves results.
import type { Priority } from "@/lib/format";
import { sql } from "@/lib/db";

/** Titles become appointments.appointment_type on approval, which is VARCHAR(100). */
export const TITLE_MAX = 100;

export type VehicleContext = {
  vehicle_id: string;
  customer_id: string;
  vehicle_number: string;
  vehicle_type: string | null;
  fuel_type: string | null;
  completed_visits: { service: string; date: string }[];
  open_appointments: { type: string; status: string; since: string }[];
  pending_follow_ups: string[];
  /** From the vehicle's latest services record; null when that visit set no next date. */
  next_due: { service: string; visit: string; date: string } | null;
};

export type Candidate = {
  customer_id: string;
  vehicle_id: string;
  vehicle_number?: string;
  /** Where the suggestion came from; next_due ones are counted separately for the button. */
  origin?: "next_due";
  recommendation_type: string;
  title: string;
  description: string | null;
  priority: Priority;
};

export type NewFollowUp = {
  vehicle_number: string;
  title: string;
  priority: Priority;
};

/** Every vehicle with at least one finished visit: a COMPLETED appointment or a services record. */
export async function getVehicleContext() {
  const rows = await sql`
    WITH visits AS (
      SELECT vehicle_id, customer_id, appointment_type AS service, created_at
      FROM appointments WHERE status = 'COMPLETED'
      UNION ALL
      SELECT vehicle_id, customer_id, service_type, created_at FROM services
    )
    SELECT v.id AS vehicle_id, latest.customer_id, v.vehicle_number, v.vehicle_type, v.fuel_type,
      (SELECT json_agg(json_build_object('service', x.service, 'date', x.created_at::date)
          ORDER BY x.created_at DESC)
        FROM visits x WHERE x.vehicle_id = v.id) AS completed_visits,
      COALESCE((
        SELECT json_agg(json_build_object('type', a.appointment_type, 'status', a.status, 'since', a.created_at::date))
        FROM appointments a WHERE a.vehicle_id = v.id AND a.status NOT IN ('COMPLETED', 'CANCELLED')
      ), '[]') AS open_appointments,
      COALESCE((
        SELECT json_agg(r.title) FROM recommendations r
        WHERE r.vehicle_id = v.id AND r.source IN ('FOLLOW_UP', 'CHAT') AND r.advisor_action = 'PENDING'
      ), '[]') AS pending_follow_ups,
      (SELECT CASE WHEN s.next_appointment_date IS NOT NULL THEN json_build_object(
          'service', s.service_type, 'visit', s.created_at::date, 'date', s.next_appointment_date) END
        FROM services s WHERE s.vehicle_id = v.id ORDER BY s.created_at DESC LIMIT 1) AS next_due
    FROM vehicles v
    JOIN LATERAL (
      SELECT customer_id FROM visits x WHERE x.vehicle_id = v.id ORDER BY x.created_at DESC LIMIT 1
    ) latest ON true`;
  return rows as VehicleContext[];
}

/** Stores candidates as PENDING follow-ups, skipping anything already waiting for review. */
export async function insertFollowUps(rows: Candidate[]) {
  if (rows.length === 0) return [];
  const inserted = await sql`
    INSERT INTO recommendations
      (customer_id, vehicle_id, recommendation_type, title, description, priority, source)
    SELECT x.customer_id, x.vehicle_id, x.recommendation_type::recommendation_type, x.title,
      x.description, x.priority::recommendation_priority, 'FOLLOW_UP'
    FROM json_to_recordset(${JSON.stringify(rows)}::json) AS x(
      customer_id uuid, vehicle_id uuid, recommendation_type text, title text, description text, priority text)
    WHERE NOT EXISTS (
      SELECT 1 FROM recommendations r
      WHERE r.vehicle_id = x.vehicle_id AND r.source IN ('FOLLOW_UP', 'CHAT')
        AND r.advisor_action = 'PENDING' AND lower(r.title) = lower(x.title)
    )
    RETURNING (SELECT vehicle_number FROM vehicles WHERE id = vehicle_id) AS vehicle_number, title, priority`;
  return inserted as NewFollowUp[];
}
