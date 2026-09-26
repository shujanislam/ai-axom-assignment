// Noticing customers slipping away. Each pass records a lapse once (retention_events is unique on
// what lapsed and when), so the job can run as often as it likes.
import "server-only";
import { sql } from "@/lib/db";
import { bookableStatuses } from "@/lib/format";
import { WORKSHOP_TZ } from "@/lib/booking/slots";

/** A booked slot counts as missed this long after it started without the car coming in. */
const MISSED_AFTER = "4 hours";
/** A booking link counts as unanswered after this long. */
const NO_REPLY_AFTER = "3 days";
/**
 * Service dates that passed longer ago than this aren't chased: on the first run it would message
 * everyone who ever lapsed, and by then an advisor should call rather than the chat nudge.
 */
const OVERDUE_LOOKBACK_DAYS = 30;

type NewEvent = { id: string };

/**
 * Booked slots that passed without a check-in: the appointment becomes MISSED (still bookable)
 * and its job card is cancelled, which frees the mechanic. Cards already started are left alone.
 */
async function detectMissed() {
  return (await sql`
    WITH missed AS (
      UPDATE appointments a SET status = 'MISSED'
      WHERE a.status = 'SCHEDULED' AND a.scheduled_at < now() - ${MISSED_AFTER}::interval
        AND NOT EXISTS (
          SELECT 1 FROM job_cards j WHERE j.appointment_id = a.id AND j.status IN ('IN_PROGRESS', 'COMPLETED'))
      RETURNING a.id, a.customer_id, a.vehicle_id, a.appointment_type, a.scheduled_at
    ), cards AS (
      UPDATE job_cards SET status = 'CANCELLED', updated_at = clock_timestamp()
      WHERE appointment_id IN (SELECT id FROM missed) AND status IN ('DRAFT', 'ASSIGNED')
    )
    INSERT INTO retention_events (customer_id, vehicle_id, kind, ref_id, lapsed_at, service, appointment_id)
    SELECT customer_id, vehicle_id, 'MISSED', id, scheduled_at, appointment_type, id FROM missed
    ON CONFLICT (kind, ref_id, lapsed_at) DO NOTHING
    RETURNING id`) as NewEvent[];
}

/** DUE appointments whose booking offer has gone unanswered: they become NO_REPLY (still bookable). */
async function detectNoReply() {
  return (await sql`
    WITH quiet AS (
      UPDATE appointments SET status = 'NO_REPLY'
      WHERE status = 'DUE' AND created_at < now() - ${NO_REPLY_AFTER}::interval
      RETURNING id, customer_id, vehicle_id, appointment_type, created_at
    )
    INSERT INTO retention_events (customer_id, vehicle_id, kind, ref_id, lapsed_at, service, appointment_id)
    SELECT customer_id, vehicle_id, 'NO_REPLY', id, created_at, appointment_type, id FROM quiet
    ON CONFLICT (kind, ref_id, lapsed_at) DO NOTHING
    RETURNING id`) as NewEvent[];
}

/**
 * Vehicles whose next service date (set at the last visit) has passed with nothing booked or
 * done since. Linked to an open appointment for the vehicle, if it has one to book.
 */
async function detectOverdue() {
  return (await sql`
    WITH last_visit AS (
      SELECT DISTINCT ON (s.vehicle_id) s.id, s.customer_id, s.vehicle_id, s.service_type, s.next_appointment_date
      FROM services s
      ORDER BY s.vehicle_id, s.created_at DESC
    ), today AS (
      SELECT (now() AT TIME ZONE ${WORKSHOP_TZ})::date AS d
    )
    INSERT INTO retention_events (customer_id, vehicle_id, kind, ref_id, lapsed_at, service, appointment_id)
    SELECT lv.customer_id, lv.vehicle_id, 'OVERDUE', lv.id,
      lv.next_appointment_date::timestamp AT TIME ZONE ${WORKSHOP_TZ},
      left(COALESCE(NULLIF(trim(split_part(lv.service_type, '·', 1)), ''), 'Periodic service'), 100),
      (SELECT a.id FROM appointments a
        WHERE a.vehicle_id = lv.vehicle_id AND a.status = ANY(${bookableStatuses})
        ORDER BY a.created_at DESC LIMIT 1)
    FROM last_visit lv CROSS JOIN today
    WHERE lv.next_appointment_date < today.d
      AND lv.next_appointment_date >= today.d - ${OVERDUE_LOOKBACK_DAYS}::int
      AND NOT EXISTS (
        SELECT 1 FROM appointments a WHERE a.vehicle_id = lv.vehicle_id AND a.status IN ('SCHEDULED', 'CHECKED_IN'))
    ON CONFLICT (kind, ref_id, lapsed_at) DO NOTHING
    RETURNING id`) as NewEvent[];
}

/** Runs every pass; returns the ids of the lapses it recorded. */
export async function detectLapses() {
  const missed = await detectMissed();
  const noReply = await detectNoReply();
  const overdue = await detectOverdue();
  console.log(`[retention] lapses: ${missed.length} missed, ${noReply.length} no reply, ${overdue.length} overdue`);
  return [...missed, ...noReply, ...overdue].map((e) => e.id);
}

/**
 * The customer skipped a booking offer. Records the lapse with what they can still book (the
 * offer's DUE appointment or recommendation, both left open). Null if already recorded.
 */
export async function recordSkip(customerId: string, messageId: string) {
  const [row] = (await sql`
    INSERT INTO retention_events
      (customer_id, vehicle_id, kind, ref_id, lapsed_at, service, appointment_id, recommendation_id)
    SELECT m.customer_id, COALESCE(a.vehicle_id, r.vehicle_id), 'SKIPPED', m.id, m.dismissed_at,
      COALESCE(a.appointment_type, left(r.title, 100), 'Service'), a.id, r.id
    FROM messages m
    LEFT JOIN appointments a ON a.id = m.appointment_id
    LEFT JOIN recommendations r ON r.id = m.recommendation_id
    WHERE m.id = ${messageId} AND m.customer_id = ${customerId} AND m.kind = 'BOOKING' AND m.dismissed_at IS NOT NULL
    ON CONFLICT (kind, ref_id, lapsed_at) DO NOTHING
    RETURNING id`) as NewEvent[];
  return row?.id ?? null;
}
