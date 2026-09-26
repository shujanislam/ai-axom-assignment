import "server-only";
import { sql } from "@/lib/db";
import type { FeedbackTopic } from "./ai-review";

/**
 * A mechanic's rating, pulled towards 4 stars until they have a few ratings, so one bad (or
 * great) visit doesn't decide who gets the next job. Needs mechanic `m` from the caller.
 */
export function mechanicScore() {
  return sql`(
    SELECT (COALESCE(sum(f.rating), 0) + 4 * 3)::numeric / (count(f.id) + 3)
    FROM feedback f WHERE f.mechanic_id = m.id
  )`;
}

export type CustomerFeedback = { date: string; service: string; rating: number; said: string | null };

/** The customer's recent ratings, for the assistant. */
export async function getCustomerFeedback(customerId: string) {
  const rows = await sql`
    SELECT f.created_at::date::text AS date, a.appointment_type AS service, f.rating,
      COALESCE(f.summary, f.comment) AS said
    FROM feedback f JOIN appointments a ON a.id = f.appointment_id
    WHERE f.customer_id = ${customerId}
    ORDER BY f.created_at DESC LIMIT 5`;
  return rows as CustomerFeedback[];
}

export type VisitFeedback = {
  rating: number;
  comment: string | null;
  sentiment: string | null;
  topics: FeedbackTopic[];
  summary: string | null;
  created_at: Date;
};

export async function getAppointmentFeedback(appointmentId: string) {
  const [row] = await sql`
    SELECT rating, comment, sentiment, topics, summary, created_at FROM feedback
    WHERE appointment_id = ${appointmentId}`;
  return (row as VisitFeedback | undefined) ?? null;
}

export type MechanicRating = { average: number | null; count: number };

export async function getMechanicRating(mechanicId: string) {
  const [row] = await sql`
    SELECT round(avg(rating), 1)::float AS average, count(*)::int AS count
    FROM feedback WHERE mechanic_id = ${mechanicId}`;
  return row as MechanicRating;
}
