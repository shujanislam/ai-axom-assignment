// Writing to a thread: posting messages, answering questions, booking from a message, and skips.
import { bookableStatuses, type Priority } from "@/lib/format";
import { formatSlot } from "@/lib/booking/slots";
import { sql } from "@/lib/db";
import { bookWithJobCard, insertJobCard } from "@/lib/job-cards/plan";
import { TITLE_MAX } from "./constants";
import type { ChatMessage } from "./thread";

export async function postCustomerMessage(customerId: string, body: string) {
  await sql`
    INSERT INTO messages (customer_id, sender, body, ai_status)
    VALUES (${customerId}, 'CUSTOMER', ${body}, 'PENDING')`;
}

export async function postAdvisorMessage(customerId: string, advisorId: string, body: string) {
  await sql`
    INSERT INTO messages (customer_id, sender, advisor_id, body)
    VALUES (${customerId}, 'ADVISOR', ${advisorId}, ${body})`;
}

export async function postAssistantMessage(
  customerId: string,
  body: string,
  extra: {
    kind?: ChatMessage["kind"];
    recommendationId?: string | null;
    appointmentId?: string | null;
    triageId?: string | null;
    options?: string[];
  } = {},
) {
  const [row] = (await sql`
    INSERT INTO messages (customer_id, sender, kind, body, recommendation_id, appointment_id, triage_id, options)
    VALUES (${customerId}, 'ASSISTANT', ${extra.kind ?? "TEXT"}, ${body.slice(0, 4000)},
      ${extra.recommendationId ?? null}, ${extra.appointmentId ?? null}, ${extra.triageId ?? null},
      ${extra.options ? JSON.stringify(extra.options) : null}::jsonb)
    RETURNING id`) as { id: string }[];
  return row.id;
}

/**
 * Posts the customer's pick as their reply, but only if the question is still the newest message
 * and the option is really one of its options, checked in the same statement as the insert.
 */
export async function answerQuestion(customerId: string, messageId: string, option: string) {
  const rows = await sql`
    INSERT INTO messages (customer_id, sender, body, ai_status)
    SELECT ${customerId}, 'CUSTOMER', ${option}, 'PENDING'
    FROM messages q
    WHERE q.id = ${messageId} AND q.customer_id = ${customerId} AND q.kind = 'QUESTION'
      AND q.options ? ${option}
      AND NOT EXISTS (
        SELECT 1 FROM messages later
        WHERE later.customer_id = q.customer_id AND (later.created_at, later.id) > (q.created_at, q.id)
      )
    RETURNING id`;
  return rows.length > 0;
}

export type NewRecommendation = { type: string; title: string; description: string | null; priority: Priority };

/** Reuses a pending recommendation with the same title for this vehicle, else raises one from chat. */
export async function ensureRecommendation(customerId: string, vehicleId: string, rec: NewRecommendation) {
  const [row] = (await sql`
    WITH existing AS (
      SELECT id FROM recommendations
      WHERE vehicle_id = ${vehicleId} AND source IN ('FOLLOW_UP', 'CHAT')
        AND advisor_action = 'PENDING' AND lower(title) = lower(${rec.title})
      LIMIT 1
    ), inserted AS (
      INSERT INTO recommendations
        (customer_id, vehicle_id, recommendation_type, title, description, priority, source)
      SELECT ${customerId}, ${vehicleId}, ${rec.type}::recommendation_type, ${rec.title}, ${rec.description},
        ${rec.priority}::recommendation_priority, 'CHAT'
      WHERE NOT EXISTS (SELECT 1 FROM existing)
      RETURNING id
    )
    SELECT id FROM inserted UNION ALL SELECT id FROM existing LIMIT 1`) as { id: string }[];
  return row.id;
}

// ---------------------------------------------------------------- booking

export type BookResult = { error?: string };

/**
 * Books a BOOKING message's slot. It either schedules the DUE appointment the message points at,
 * or creates a scheduled appointment from its recommendation, and creates the job card with a
 * free mechanic, in one statement either way.
 */
export async function bookFromMessage(customerId: string, messageId: string, slot: Date): Promise<BookResult> {
  const [message] = (await sql`
    SELECT m.appointment_id, m.recommendation_id, COALESCE(a.appointment_type, left(r.title, 100)) AS job
    FROM messages m
    LEFT JOIN appointments a ON a.id = m.appointment_id
    LEFT JOIN recommendations r ON r.id = m.recommendation_id
    WHERE m.id = ${messageId} AND m.customer_id = ${customerId} AND m.kind = 'BOOKING' AND m.dismissed_at IS NULL`) as {
    appointment_id: string | null;
    recommendation_id: string | null;
    job: string | null;
  }[];
  if (!message?.job) return { error: "This booking is no longer available." };

  const at = slot.toISOString();
  const booked = (await bookWithJobCard(message.job, slot, (plan) =>
    message.appointment_id
      ? sql`
        WITH appt AS (
          UPDATE appointments SET status = 'SCHEDULED', scheduled_at = ${at}
          WHERE id = ${message.appointment_id} AND customer_id = ${customerId} AND status = ANY(${bookableStatuses})
          RETURNING id, customer_id, vehicle_id, appointment_type
        ), card AS (${insertJobCard(plan)})
        SELECT appointment_type FROM appt`
      : sql`
        WITH rec AS (
          UPDATE recommendations SET advisor_action = 'APPROVED'
          WHERE id = ${message.recommendation_id} AND customer_id = ${customerId} AND advisor_action = 'PENDING'
          RETURNING customer_id, vehicle_id, title
        ), appt AS (
          INSERT INTO appointments (customer_id, vehicle_id, appointment_type, status, scheduled_at)
          SELECT customer_id, vehicle_id, left(title, 100), 'SCHEDULED', ${at} FROM rec
          RETURNING id, customer_id, vehicle_id, appointment_type
        ), card AS (${insertJobCard(plan)}
        ), link AS (
          UPDATE messages SET appointment_id = (SELECT id FROM appt)
          WHERE id = ${messageId} AND EXISTS (SELECT 1 FROM appt)
        )
        SELECT appointment_type FROM appt`,
  )) as { appointment_type: string }[] | null;
  if (booked === null) return { error: "Someone just took that slot. Pick another one." };
  if (booked.length === 0) return { error: "This booking is no longer available." };

  await postAssistantMessage(
    customerId,
    `Booked: **${booked[0].appointment_type}** on **${formatSlot(slot)}**. See you then!`,
  );
  return {};
}

// ------------------------------------------------------------------ skips

/**
 * Closes a booking offer the customer doesn't want. What it points at is left alone: a DUE
 * appointment can still be booked from the email link, a recommendation stays on /service-due.
 * The reply is the retention question (see lib/retention), posted by the caller.
 */
export async function skipBooking(customerId: string, messageId: string) {
  const rows = await sql`
    UPDATE messages SET dismissed_at = clock_timestamp()
    WHERE id = ${messageId} AND customer_id = ${customerId} AND kind = 'BOOKING' AND dismissed_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

export const SKIP_BOOKING_REPLY = "No problem. Just message us here whenever you’d like to book a visit.";

/**
 * The customer skips the triage questions. No model call: the problem goes straight to an advisor
 * as an inspection to review, and the customer may book a slot (or skip that too).
 * Only allowed while the question is the newest message, i.e. nobody is mid-answer.
 */
export async function skipTriage(customerId: string, questionId: string) {
  const [triage] = (await sql`
    UPDATE triages t SET status = 'SKIPPED', fault = 'UNCLEAR', fixable = 'UNCLEAR', closed_at = clock_timestamp()
    FROM messages q
    WHERE q.id = ${questionId} AND q.customer_id = ${customerId} AND q.kind = 'QUESTION'
      AND t.id = q.triage_id AND t.status = 'OPEN'
      AND NOT EXISTS (
        SELECT 1 FROM messages later
        WHERE later.customer_id = q.customer_id AND (later.created_at, later.id) > (q.created_at, q.id)
      )
    RETURNING t.id, t.vehicle_id, t.summary`) as { id: string; vehicle_id: string | null; summary: string }[];
  if (!triage) return false;

  await sql`INSERT INTO messages (customer_id, sender, body, triage_id) VALUES (${customerId}, 'CUSTOMER', 'Skip the questions', ${triage.id})`;

  // The triage may not know the vehicle yet; a customer with a single vehicle is unambiguous.
  const vehicles = (await sql`
    SELECT v.id, v.vehicle_number FROM vehicles v
    WHERE v.id = ${triage.vehicle_id} OR (${triage.vehicle_id}::uuid IS NULL AND v.id IN (
      SELECT vehicle_id FROM appointments WHERE customer_id = ${customerId}
      UNION SELECT vehicle_id FROM services WHERE customer_id = ${customerId}
    ))`) as { id: string; vehicle_number: string }[];
  const vehicle = vehicles.length === 1 ? vehicles[0] : undefined;

  let recommendationId: string | null = null;
  if (vehicle) {
    await sql`INSERT INTO complaints (customer_id, vehicle_id, complaint_type) VALUES (${customerId}, ${vehicle.id}, 'OTHER')`;
    recommendationId = await ensureRecommendation(customerId, vehicle.id, {
      type: "INSPECTION",
      title: `Inspection: ${triage.summary}`.slice(0, TITLE_MAX),
      description: `Chat triage skipped by the customer: ${triage.summary}. Needs an advisor to assess.`,
      priority: "MEDIUM",
    });
  }

  const messageId = await postAssistantMessage(
    customerId,
    vehicle
      ? "No problem, we’ll skip the questions. An advisor will look into it. If you’d like us to check the vehicle, pick a slot below, or skip booking."
      : "No problem, we’ll skip the questions. An advisor will look into it and get back to you here.",
    { triageId: triage.id, recommendationId },
  );
  await sql`
    UPDATE triages SET vehicle_id = ${vehicle?.id ?? triage.vehicle_id}, recommendation_id = ${recommendationId},
      concluded_message_id = ${messageId}
    WHERE id = ${triage.id}`;

  if (vehicle && recommendationId) {
    await postAssistantMessage(
      customerId,
      `Pick a time for **Inspection: ${triage.summary}** on ${vehicle.vehicle_number}:`,
      {
        kind: "BOOKING",
        recommendationId,
        triageId: triage.id,
      },
    );
  }
  return true;
}
