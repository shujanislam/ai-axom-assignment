// Reaching a customer after a lapse: ask in the chat what got in the way (and email them), then
// act on the answer. Deterministic on purpose: no model call stands between a customer and a slot.
import "server-only";
import { bookableStatuses, formatDate } from "@/lib/format";
import { sql } from "@/lib/db";
import { formatSlot } from "@/lib/booking/slots";
import { ensureRecommendation, postAssistantMessage } from "@/lib/chat/messages";
import { formatRupees } from "@/lib/invoices/pricing";
import { planJob } from "@/lib/job-cards/plan";
import { sendRetentionEmail } from "@/lib/mail/retention-email";
import { REASONS, reasonCode, type LapseKind, type ReasonCode } from "./reasons";

/** At most one nudge per customer in this long; a skip in the chat is answered regardless. */
const QUIET_DAYS = 5;

type Lapse = {
  id: string;
  customer_id: string;
  vehicle_id: string | null;
  kind: LapseKind;
  lapsed_at: Date;
  service: string;
  appointment_id: string | null;
  appointment_bookable: boolean;
  recommendation_id: string | null;
  customer_name: string;
  email: string | null;
  plate: string | null;
};

async function getLapse(id: string) {
  const [row] = await sql`
    SELECT e.id, e.customer_id, e.vehicle_id, e.kind, e.lapsed_at, e.service, e.appointment_id,
      COALESCE(a.status = ANY(${bookableStatuses}), false) AS appointment_bookable, e.recommendation_id,
      split_part(c.name, ' ', 1) AS customer_name, c.email, v.vehicle_number AS plate
    FROM retention_events e
    JOIN customers c ON c.id = e.customer_id
    LEFT JOIN vehicles v ON v.id = e.vehicle_id
    LEFT JOIN appointments a ON a.id = e.appointment_id
    WHERE e.id = ${id}`;
  return row as Lapse;
}

/** The question, in the chat and in the email. */
function ask(e: Lapse) {
  const car = e.plate ?? "your vehicle";
  switch (e.kind) {
    case "MISSED":
      return {
        subject: `We missed you today`,
        lines: [`We missed you for ${e.service} on ${car} (${formatSlot(e.lapsed_at)}). No worries, it happens!`],
        chat: `We missed you for **${e.service}** on ${car} (${formatSlot(e.lapsed_at)}). No worries, it happens! What got in the way?`,
      };
    case "NO_REPLY":
      return {
        subject: `${e.service} for ${car}`,
        lines: [`Just checking in: your ${car} is still due for ${e.service}.`],
        chat: `Just checking in: your ${car} is still due for **${e.service}**. Is anything stopping you from booking?`,
      };
    case "OVERDUE":
      return {
        subject: `${car} was due for service`,
        lines: [`Your ${car} was due for ${e.service} on ${formatDate(e.lapsed_at)}. Is everything alright?`],
        chat: `Your ${car} was due for **${e.service}** on ${formatDate(e.lapsed_at)}. Is everything alright? What’s kept you from coming in?`,
      };
    case "SKIPPED":
      return {
        subject: "",
        lines: [],
        chat: "No problem, nothing is booked. So we can help better next time, what’s holding you back?",
      };
  }
}

function bookingLink(appointmentId: string) {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  return base ? `${base}/${appointmentId}` : null;
}

/**
 * Asks each lapsed customer what got in the way, in the chat and by email. Claims the lapse in the
 * same statement that checks the guards, so a customer is never asked twice for one lapse, never
 * more than once in QUIET_DAYS, and never in the middle of a triage or another unanswered question.
 * Held-back lapses stay unasked; the owner still hears about them.
 */
export async function reachOut(eventIds: string[]) {
  let asked = 0;
  for (const id of eventIds) {
    const [claimed] = await sql`
      UPDATE retention_events e SET customer_notified_at = clock_timestamp()
      WHERE e.id = ${id} AND e.customer_notified_at IS NULL
        AND (e.kind = 'SKIPPED' OR (
          NOT EXISTS (
            SELECT 1 FROM retention_events o
            WHERE o.customer_id = e.customer_id AND o.id <> e.id
              AND o.customer_notified_at > now() - ${`${QUIET_DAYS} days`}::interval)
          AND NOT EXISTS (SELECT 1 FROM triages t WHERE t.customer_id = e.customer_id AND t.status = 'OPEN')
          AND NOT EXISTS (
            SELECT 1 FROM messages m JOIN retention_events q ON q.id = m.retention_event_id
            WHERE m.customer_id = e.customer_id AND m.kind = 'REASON' AND q.reason IS NULL)))
      RETURNING e.id`;
    if (!claimed) continue;

    const e = await getLapse(id);
    const q = ask(e);
    await sql`
      INSERT INTO messages (customer_id, sender, kind, body, options, retention_event_id, appointment_id)
      VALUES (${e.customer_id}, 'ASSISTANT', 'REASON', ${q.chat}, ${JSON.stringify(REASONS.map((r) => r.label))}::jsonb,
        ${e.id}, ${e.appointment_id})`;
    asked++;

    if (e.kind === "SKIPPED" || !e.email) continue;
    try {
      await sendRetentionEmail({
        to: e.email,
        name: e.customer_name,
        subject: q.subject,
        lines: q.lines,
        link: e.appointment_id && e.appointment_bookable ? bookingLink(e.appointment_id) : null,
      });
    } catch (error) {
      console.error(`[retention] email for lapse ${e.id} failed:`, error);
    }
  }
  return asked;
}

/** A slot picker for what the lapse was about: its open appointment, its recommendation, or a new one. */
async function offerSlots(e: Lapse, intro: string) {
  if (e.appointment_id && e.appointment_bookable) {
    return postAssistantMessage(e.customer_id, intro, { kind: "BOOKING", appointmentId: e.appointment_id });
  }
  const [pending] = e.recommendation_id
    ? await sql`SELECT 1 FROM recommendations WHERE id = ${e.recommendation_id} AND advisor_action = 'PENDING'`
    : [];
  const recommendationId = pending
    ? e.recommendation_id
    : e.vehicle_id
      ? await ensureRecommendation(e.customer_id, e.vehicle_id, {
          type: "SERVICE",
          title: e.service,
          description: "The customer asked for a new time after a lapse.",
          priority: "MEDIUM",
        })
      : null;
  if (!recommendationId) {
    return postAssistantMessage(e.customer_id, "Tell us which day suits you and we’ll book you in.");
  }
  return postAssistantMessage(e.customer_id, intro, { kind: "BOOKING", recommendationId });
}

/** Stops chasing: the open appointment is declined and the recommendation rejected. */
async function closeLapse(e: Lapse) {
  await sql`
    UPDATE appointments SET status = 'DECLINED'
    WHERE id = ${e.appointment_id} AND status = ANY(${bookableStatuses})`;
  await sql`
    UPDATE recommendations SET advisor_action = 'REJECTED'
    WHERE id = ${e.recommendation_id} AND advisor_action = 'PENDING'`;
}

async function respond(e: Lapse, reason: ReasonCode) {
  switch (reason) {
    case "TIMING":
      return offerSlots(e, `No problem. Here are the next free times for **${e.service}**. Pick whichever suits you:`);
    case "PRICE": {
      const { estimate } = await planJob(e.service, new Date());
      await postAssistantMessage(
        e.customer_id,
        `Understood. **${e.service}** usually comes to about **${formatRupees(estimate.total)}** including GST. ` +
          "An advisor will get in touch to go through what’s urgent and what can safely wait.",
      );
      return;
    }
    case "ELSEWHERE":
      await closeLapse(e);
      await postAssistantMessage(
        e.customer_id,
        "Thanks for letting us know! We’ve updated our records, so we won’t remind you about this one.",
      );
      return;
    case "CAR_FINE":
      await postAssistantMessage(
        e.customer_id,
        `Glad it’s running well! **${e.service}** is about catching wear before it turns into a bigger repair: ` +
          "problems found early usually cost a fraction of fixing a breakdown. Whenever you’d like it checked, just message us here.",
      );
      return;
    case "UNHAPPY":
      if (e.vehicle_id) {
        await sql`
          INSERT INTO complaints (customer_id, vehicle_id, complaint_type)
          VALUES (${e.customer_id}, ${e.vehicle_id}, 'SERVICE_ISSUE'::complaint_type)`;
      }
      await postAssistantMessage(
        e.customer_id,
        "We’re really sorry to hear that. The workshop owner has been told and will get in touch with you personally.",
      );
      return;
  }
}

/**
 * The customer picked a reason on a REASON message. Saves it once, posts their pick as their reply
 * (not for the assistant to answer), and acts on it. Returns the reason and the lapse, or null if
 * the message isn't theirs, the label isn't a reason, or it was already answered.
 */
export async function answerReason(customerId: string, messageId: string, label: string) {
  const reason = reasonCode(label);
  if (!reason) return null;
  const [answered] = (await sql`
    UPDATE retention_events e SET reason = ${reason}, answered_at = clock_timestamp()
    FROM messages m
    WHERE m.id = ${messageId} AND m.customer_id = ${customerId} AND m.kind = 'REASON'
      AND e.id = m.retention_event_id AND e.reason IS NULL
    RETURNING e.id`) as { id: string }[];
  if (!answered) return null;

  await sql`INSERT INTO messages (customer_id, sender, body) VALUES (${customerId}, 'CUSTOMER', ${label})`;
  const e = await getLapse(answered.id);
  await respond(e, reason);
  return { reason, lapseId: e.id };
}
