import "server-only";
import { cache } from "react";
import type { AdvisorAction, Priority } from "../format";
import { sql } from "./db";

// ------------------------------------------------------------- service due

export type FollowUpRow = {
  id: string;
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
    SELECT r.id, r.recommendation_type, r.title, r.description, r.priority, r.created_at,
      v.vehicle_number, v.vehicle_type, c.name AS customer_name, c.phone_number, c.preferred_language,
      GREATEST(
        (SELECT max(s.created_at) FROM services s WHERE s.vehicle_id = v.id),
        (SELECT max(a.created_at) FROM appointments a WHERE a.vehicle_id = v.id AND a.status = 'COMPLETED')
      ) AS last_service_at
    FROM recommendations r
    JOIN vehicles v ON v.id = r.vehicle_id
    JOIN customers c ON c.id = r.customer_id
    WHERE r.source = 'FOLLOW_UP' AND r.advisor_action = 'PENDING'
    ORDER BY
      CASE r.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
      r.created_at DESC`;
  return rows as FollowUpRow[];
}

/** Follow-ups approved into DUE appointments. */
export async function countApprovedFollowUps() {
  const [row] = await sql`
    SELECT count(*)::int AS n FROM recommendations WHERE source = 'FOLLOW_UP' AND advisor_action = 'APPROVED'`;
  return (row as { n: number }).n;
}

// ------------------------------------------------------------------ today

export type Arrival = {
  vehicle_number: string;
  vehicle_type: string | null;
  fuel_type: string | null;
  customer_name: string;
  appointment_type: string;
  created_at: Date;
  advisor_name: string | null;
  open_recommendations: number;
};

export async function getArrivals() {
  const rows = await sql`
    SELECT v.vehicle_number, v.vehicle_type, v.fuel_type, c.name AS customer_name,
      a.appointment_type, a.created_at, adv.name AS advisor_name,
      (SELECT count(*)::int FROM recommendations r
        WHERE r.vehicle_id = v.id AND r.source = 'WORKSHOP' AND r.advisor_action = 'PENDING') AS open_recommendations
    FROM appointments a
    JOIN vehicles v ON v.id = a.vehicle_id
    JOIN customers c ON c.id = a.customer_id
    LEFT JOIN advisors adv ON adv.id = a.assigned_to
    WHERE a.status = 'CHECKED_IN'
    ORDER BY a.created_at`;
  return rows as Arrival[];
}

// ---------------------------------------------------------------- vehicle

export type VehicleDetail = {
  id: string;
  vehicle_number: string;
  vehicle_type: string | null;
  fuel_type: string | null;
  registration_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  preferred_language: string | null;
  appointment_type: string | null;
  appointment_status: string | null;
  appointment_at: Date | null;
  advisor_name: string | null;
};

export type ServiceRow = { id: string; service_type: string; created_at: Date; appointment_type: string | null };
export type ComplaintRow = { id: string; complaint_type: string; created_at: Date };

/** Vehicle with its latest appointment and that appointment's customer. */
export const getVehicle = cache(async (plate: string) => {
  const rows = await sql`
    SELECT v.id, v.vehicle_number, v.vehicle_type, v.fuel_type, v.registration_number,
      c.id AS customer_id, c.name AS customer_name, c.phone_number AS customer_phone,
      c.email AS customer_email, c.preferred_language,
      a.appointment_type, a.status AS appointment_status, a.created_at AS appointment_at,
      adv.name AS advisor_name
    FROM vehicles v
    LEFT JOIN LATERAL (
      SELECT * FROM appointments WHERE vehicle_id = v.id ORDER BY created_at DESC LIMIT 1
    ) a ON true
    LEFT JOIN customers c ON c.id = coalesce(
      a.customer_id,
      (SELECT customer_id FROM services WHERE vehicle_id = v.id ORDER BY created_at DESC LIMIT 1)
    )
    LEFT JOIN advisors adv ON adv.id = a.assigned_to
    WHERE v.vehicle_number = ${plate}`;
  return (rows[0] as VehicleDetail | undefined) ?? null;
});

export async function getServiceHistory(vehicleId: string) {
  const rows = await sql`
    SELECT s.id, s.service_type, s.created_at, a.appointment_type
    FROM services s
    LEFT JOIN appointments a ON a.id = s.appointment_id
    WHERE s.vehicle_id = ${vehicleId}
    ORDER BY s.created_at DESC`;
  return rows as ServiceRow[];
}

export async function getComplaints(vehicleId: string) {
  const rows = await sql`
    SELECT id, complaint_type, created_at FROM complaints
    WHERE vehicle_id = ${vehicleId}
    ORDER BY created_at DESC`;
  return rows as ComplaintRow[];
}

// -------------------------------------------------------- recommendations

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

// ----------------------------------------------------------- appointments

export type AppointmentRow = {
  id: string;
  vehicle_number: string;
  customer_name: string;
  appointment_type: string;
  status: string;
  advisor_name: string | null;
  created_at: Date;
};

export async function getAppointments() {
  const rows = await sql`
    SELECT a.id, v.vehicle_number, c.name AS customer_name, a.appointment_type, a.status,
      adv.name AS advisor_name, a.created_at
    FROM appointments a
    JOIN vehicles v ON v.id = a.vehicle_id
    JOIN customers c ON c.id = a.customer_id
    LEFT JOIN advisors adv ON adv.id = a.assigned_to
    ORDER BY a.created_at DESC`;
  return rows as AppointmentRow[];
}

// ---------------------------------------------------------------- booking

export type BookingAppointment = {
  id: string;
  appointment_type: string;
  status: string;
  scheduled_at: Date | null;
  customer_name: string;
  vehicle_number: string;
  vehicle_type: string | null;
};

/** What the customer's booking link shows. Only the first name leaves the database. */
export async function getBookingAppointment(id: string) {
  const [row] = await sql`
    SELECT a.id, a.appointment_type, a.status, a.scheduled_at,
      split_part(c.name, ' ', 1) AS customer_name, v.vehicle_number, v.vehicle_type
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN vehicles v ON v.id = a.vehicle_id
    WHERE a.id = ${id}`;
  return (row as BookingAppointment | undefined) ?? null;
}
