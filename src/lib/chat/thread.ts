// Reading conversations: a customer's thread, the advisor's list, and what each message can still do.
import { sql } from "@/lib/db";

export type Sender = "CUSTOMER" | "ADVISOR" | "ASSISTANT";

export type ChatMessage = {
  id: string;
  sender: Sender;
  kind: "TEXT" | "BOOKING" | "QUESTION";
  body: string;
  options: string[] | null;
  triage_id: string | null;
  /** Set on the message that concluded a triage: the verdict, for advisors. */
  verdict: { status: string; fault: string | null; fixable: string | null } | null;
  /** Set when the customer skipped this BOOKING offer. */
  dismissed_at: Date | null;
  created_at: Date;
  ai_status: string | null;
  advisor_name: string | null;
  appointment_status: string | null;
  scheduled_at: Date | null;
  recommendation_action: string | null;
};

export async function getThread(customerId: string) {
  const rows = await sql`
    SELECT m.id, m.sender, m.kind, m.body, m.options, m.triage_id, m.created_at, m.ai_status, m.dismissed_at,
      adv.name AS advisor_name, a.status AS appointment_status, a.scheduled_at,
      r.advisor_action AS recommendation_action,
      CASE WHEN t.id IS NOT NULL
        THEN json_build_object('status', t.status, 'fault', t.fault, 'fixable', t.fixable) END AS verdict
    FROM messages m
    LEFT JOIN advisors adv ON adv.id = m.advisor_id
    LEFT JOIN appointments a ON a.id = m.appointment_id
    LEFT JOIN recommendations r ON r.id = m.recommendation_id
    LEFT JOIN triages t ON t.concluded_message_id = m.id
    WHERE m.customer_id = ${customerId}
    ORDER BY m.created_at, m.id`;
  return rows as ChatMessage[];
}

/** What a BOOKING message can still do. */
export function bookingState(
  m: ChatMessage,
): { open: true } | { open: false; bookedAt: Date | null; skipped?: boolean } {
  if (m.appointment_status === "SCHEDULED" && m.scheduled_at) return { open: false, bookedAt: m.scheduled_at };
  if (m.dismissed_at) return { open: false, bookedAt: null, skipped: true };
  if (m.appointment_status === "DUE") return { open: true };
  if (m.appointment_status === null && m.recommendation_action === "PENDING") return { open: true };
  return { open: false, bookedAt: null };
}

/** A question can be answered only while it is the newest one and nothing came after it. */
export function answerableQuestionId(thread: ChatMessage[]) {
  const last = thread.at(-1);
  return last?.kind === "QUESTION" ? last.id : null;
}

/** The option the customer picked for each question: their next message, if it is an option. */
export function chosenOptions(thread: ChatMessage[]) {
  const chosen = new Map<string, string>();
  thread.forEach((m, i) => {
    const next = thread[i + 1];
    if (m.kind === "QUESTION" && next?.sender === "CUSTOMER" && m.options?.includes(next.body)) {
      chosen.set(m.id, next.body);
    }
  });
  return chosen;
}

/** True while the assistant is working on the customer's latest message. */
export function assistantTyping(thread: ChatMessage[]) {
  const last = thread.at(-1);
  // A crashed run leaves no reply; stop showing "typing" after a few minutes.
  return last?.sender === "CUSTOMER" && last.ai_status !== "FAILED" && Date.now() - +last.created_at < 3 * 60_000;
}

export type Conversation = {
  customer_id: string;
  customer_name: string;
  phone_number: string;
  vehicles: string[];
  last_body: string;
  last_sender: Sender;
  last_kind: ChatMessage["kind"];
  last_at: Date;
  /** Customer messages since the workshop (advisor or assistant) last wrote. */
  unanswered: number;
};

export async function getConversations() {
  const rows = await sql`
    SELECT c.id AS customer_id, c.name AS customer_name, c.phone_number,
      COALESCE((
        SELECT array_agg(DISTINCT v.vehicle_number) FROM vehicles v
        WHERE v.id IN (
          SELECT vehicle_id FROM appointments WHERE customer_id = c.id
          UNION SELECT vehicle_id FROM services WHERE customer_id = c.id
        )
      ), '{}') AS vehicles,
      last.body AS last_body, last.sender AS last_sender, last.kind AS last_kind, last.created_at AS last_at,
      (SELECT count(*)::int FROM messages m
        WHERE m.customer_id = c.id AND m.sender = 'CUSTOMER'
          AND m.created_at > COALESCE((
            SELECT max(created_at) FROM messages w WHERE w.customer_id = c.id AND w.sender <> 'CUSTOMER'
          ), '-infinity')) AS unanswered
    FROM customers c
    JOIN LATERAL (
      SELECT body, sender, kind, created_at FROM messages m
      WHERE m.customer_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1
    ) last ON true
    ORDER BY last.created_at DESC`;
  return rows as Conversation[];
}
