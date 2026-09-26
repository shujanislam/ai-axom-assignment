import { priorities, recommendationTypes, type Priority } from "../format";
import { aiClient, aiModel, parseJsonObject } from "./ai";
import { sql } from "./db";
import { formatSlot } from "./slots";

const TITLE_MAX = 100; // becomes appointments.appointment_type, VARCHAR(100)
const HISTORY = 20; // messages the assistant sees
const COMPLAINT_TYPES = [
  "SERVICE_ISSUE",
  "VEHICLE_ISSUE",
  "STAFF_BEHAVIOR",
  "DELAY",
  "BILLING_ISSUE",
  "PARTS_ISSUE",
  "OTHER",
] as const;

/** Triage asks at least one and at most this many multiple-choice questions per problem. */
export const MAX_QUESTIONS = 5;
const OPTION_MAX = 80;
const FAULTS = ["WORKSHOP", "CUSTOMER", "WEAR", "UNCLEAR"] as const;
const FIXABLE = ["IN_HOUSE", "SPECIALIST", "DIY", "UNCLEAR"] as const;

const TRIAGE_FALLBACK_REPLY =
  "Sorry, that took too long on our side. Please send your last answer again and we’ll carry on.";
const FALLBACK_REPLY =
  "Sorry, I couldn’t process that just now. An advisor has your message and will reply here shortly.";

// ------------------------------------------------------------------ reads

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

// ----------------------------------------------------------------- writes

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

async function postAssistantMessage(
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

type NewRecommendation = { type: string; title: string; description: string | null; priority: Priority };

/** Reuses a pending recommendation with the same title for this vehicle, else raises one from chat. */
async function ensureRecommendation(customerId: string, vehicleId: string, rec: NewRecommendation) {
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
 * or creates a scheduled appointment from its recommendation, in one statement either way.
 */
export async function bookFromMessage(customerId: string, messageId: string, slot: Date): Promise<BookResult> {
  const [message] = (await sql`
    SELECT appointment_id, recommendation_id FROM messages
    WHERE id = ${messageId} AND customer_id = ${customerId} AND kind = 'BOOKING' AND dismissed_at IS NULL`) as {
    appointment_id: string | null;
    recommendation_id: string | null;
  }[];
  if (!message) return { error: "This booking is no longer available." };

  const at = slot.toISOString();
  let booked: { appointment_type: string }[] = [];
  try {
    if (message.appointment_id) {
      booked = (await sql`
        UPDATE appointments SET status = 'SCHEDULED', scheduled_at = ${at}
        WHERE id = ${message.appointment_id} AND customer_id = ${customerId} AND status = 'DUE'
        RETURNING appointment_type`) as typeof booked;
    } else if (message.recommendation_id) {
      booked = (await sql`
        WITH rec AS (
          UPDATE recommendations SET advisor_action = 'APPROVED'
          WHERE id = ${message.recommendation_id} AND customer_id = ${customerId} AND advisor_action = 'PENDING'
          RETURNING customer_id, vehicle_id, title
        ), appt AS (
          INSERT INTO appointments (customer_id, vehicle_id, appointment_type, status, scheduled_at)
          SELECT customer_id, vehicle_id, left(title, 100), 'SCHEDULED', ${at} FROM rec
          RETURNING id, appointment_type
        ), link AS (
          UPDATE messages SET appointment_id = (SELECT id FROM appt)
          WHERE id = ${messageId} AND EXISTS (SELECT 1 FROM appt)
        )
        SELECT appointment_type FROM appt`) as typeof booked;
    }
  } catch (error) {
    // appointments_scheduled_slot_idx: someone else booked this slot a moment ago.
    if ((error as { code?: string }).code === "23505")
      return { error: "Someone just took that slot. Pick another one." };
    throw error;
  }
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
 */
export async function skipBooking(customerId: string, messageId: string) {
  const rows = await sql`
    UPDATE messages SET dismissed_at = clock_timestamp()
    WHERE id = ${messageId} AND customer_id = ${customerId} AND kind = 'BOOKING' AND dismissed_at IS NULL
    RETURNING id`;
  if (rows.length === 0) return false;
  await postAssistantMessage(customerId, "No problem. Just message us here whenever you’d like to book a visit.");
  return true;
}

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

// -------------------------------------------------------------- assistant

type Vehicle = { id: string; vehicle_number: string; vehicle_type: string | null; fuel_type: string | null };
type OpenTriage = { id: string; vehicle_id: string | null; summary: string; questions: number };

type CustomerContext = {
  name: string;
  vehicles: Vehicle[];
  visits: { vehicle_number: string; service: string; date: string }[];
  open_appointments: { vehicle_number: string; type: string; status: string; scheduled_at: string | null }[];
  suggested: { vehicle_number: string; title: string; priority: string }[];
  triage: OpenTriage | null;
};

async function getCustomerContext(customerId: string): Promise<CustomerContext> {
  const [[customer], vehicles, visits, open, suggested, [triage]] = await Promise.all([
    sql`SELECT name FROM customers WHERE id = ${customerId}`,
    sql`
      SELECT v.id, v.vehicle_number, v.vehicle_type, v.fuel_type FROM vehicles v
      WHERE v.id IN (
        SELECT vehicle_id FROM appointments WHERE customer_id = ${customerId}
        UNION SELECT vehicle_id FROM services WHERE customer_id = ${customerId}
      )`,
    sql`
      SELECT v.vehicle_number, s.service_type AS service, s.created_at::date::text AS date
      FROM services s JOIN vehicles v ON v.id = s.vehicle_id
      WHERE s.customer_id = ${customerId} ORDER BY s.created_at DESC LIMIT 10`,
    sql`
      SELECT v.vehicle_number, a.appointment_type AS type, a.status, a.scheduled_at::text AS scheduled_at
      FROM appointments a JOIN vehicles v ON v.id = a.vehicle_id
      WHERE a.customer_id = ${customerId} AND a.status NOT IN ('COMPLETED', 'CANCELLED')`,
    sql`
      SELECT v.vehicle_number, r.title, r.priority FROM recommendations r JOIN vehicles v ON v.id = r.vehicle_id
      WHERE r.customer_id = ${customerId} AND r.source IN ('FOLLOW_UP', 'CHAT') AND r.advisor_action = 'PENDING'`,
    sql`
      SELECT t.id, t.vehicle_id, t.summary,
        (SELECT count(*)::int FROM messages m WHERE m.triage_id = t.id AND m.kind = 'QUESTION') AS questions
      FROM triages t WHERE t.customer_id = ${customerId} AND t.status = 'OPEN'`,
  ]);
  return {
    name: (customer as { name: string }).name,
    vehicles: vehicles as Vehicle[],
    visits: visits as CustomerContext["visits"],
    open_appointments: open as CustomerContext["open_appointments"],
    suggested: suggested as CustomerContext["suggested"],
    triage: (triage as OpenTriage | undefined) ?? null,
  };
}

const SYSTEM_PROMPT = `You are the service assistant of a car workshop in India, chatting with a customer.
You get the customer's vehicles, recent visits, open appointments, services already suggested, any
problem currently being triaged, and the conversation so far. Answer the customer's latest message.

Reply with JSON only, no prose, exactly:
{"reply":"...","problem":null,"question":null,"assessment":null,"booking":null}

- "reply": what you say to the customer, short and friendly Markdown (under 100 words; bold and
  bullet lists are fine; no tables, code or headings). Use the customer's language.

TRIAGE. When the customer reports a problem with a vehicle, or a complaint about the workshop, do
not jump to an appointment. Find out what is going on with multiple-choice questions first:
- "problem": {"vehicle_number":"...","summary":"one line"} when a NEW problem is reported and no
  triage is open. Always ask the first question in the same reply.
- "question": {"text":"...","options":["...","..."]}. One question per reply, 2-5 short options,
  add "Not sure" when it helps. Ask what tells you: where it comes from and when it happens, how
  bad it is and whether it's getting worse, whether it started after our last service (our fault?)
  or from use, wear or an accident (theirs?), and whether it needs the workshop at all.
- Ask at least 1 and at most ${MAX_QUESTIONS} questions per problem. Stop as soon as you are sure.
- "assessment": once you are sure (at the latest after question ${MAX_QUESTIONS} is answered):
  {"vehicle_number":"...","outcome":"CONSULT|APPOINTMENT","fault":"${FAULTS.join("|")}","fixable":"${FIXABLE.join("|")}",
   "complaint_type":"${COMPLAINT_TYPES.join("|")}","recommendation_type":"${recommendationTypes.join("|")}",
   "title":"service to book, max 60 chars","description":"one sentence for the advisor",
   "priority":"${priorities.join("|")}"}
  CONSULT when it's normal behaviour, minor, or advice is enough: put the advice in "reply".
  APPOINTMENT when it needs the workshop, or anything safety-related (brakes, steering, tyres,
  suspension, warning lights, leaks, smoke) unless clearly harmless: tell them to pick a slot below.
  Never set "question" and "assessment" together.

BOOKING. "booking": {"vehicle_number":"...","service":"max 60 chars"} only when the customer clearly
asks to book a service that is not the problem being triaged. Otherwise null.

- vehicle_number must be one of the customer's vehicles; if unclear, ask which one first.
- Never quote prices, promise a diagnosis, or invent dates or times: the app shows free slots.`;

type AssistantTurn = {
  reply?: string;
  problem?: { vehicle_number?: string; summary?: string } | null;
  question?: { text?: string; options?: unknown } | null;
  assessment?: {
    vehicle_number?: string;
    outcome?: string;
    fault?: string;
    fixable?: string;
    complaint_type?: string;
    recommendation_type?: string;
    title?: string;
    description?: string;
    priority?: string;
  } | null;
  booking?: { vehicle_number?: string; service?: string } | null;
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const text = (value: unknown, max: number) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

/** 2-5 distinct, non-empty options, or null if the model's list can't be salvaged. */
function cleanOptions(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const options = [...new Set(value.map((o) => text(o, OPTION_MAX)).filter(Boolean))].slice(0, MAX_QUESTIONS);
  return options.length >= 2 ? options : null;
}

async function openTriage(customerId: string, vehicleId: string | null, summary: string): Promise<OpenTriage> {
  // triages_one_open_idx allows one open triage per customer; a concurrent run may have won.
  const [row] = (await sql`
    WITH inserted AS (
      INSERT INTO triages (customer_id, vehicle_id, summary)
      VALUES (${customerId}, ${vehicleId}, ${summary})
      ON CONFLICT (customer_id) WHERE status = 'OPEN' DO NOTHING
      RETURNING id, vehicle_id, summary
    )
    SELECT id, vehicle_id, summary FROM inserted
    UNION ALL
    SELECT id, vehicle_id, summary FROM triages WHERE customer_id = ${customerId} AND status = 'OPEN'
    LIMIT 1`) as Omit<OpenTriage, "questions">[];
  return { ...row, questions: 0 };
}

type Assessment = NonNullable<AssistantTurn["assessment"]>;

/**
 * Closes the triage. Every problem is logged as a complaint; only APPOINTMENT raises a
 * recommendation (shown on /service-due) and offers slots.
 */
async function concludeTriage(customerId: string, triage: OpenTriage, vehicle: Vehicle, a: Assessment, reply: string) {
  const outcome = a.outcome === "CONSULT" ? "CONSULT" : "APPOINTMENT";
  const fault = oneOf(a.fault, FAULTS, "UNCLEAR");
  const fixable = oneOf(a.fixable, FIXABLE, "UNCLEAR");
  const title = text(a.title, TITLE_MAX) || `Inspection: ${text(triage.summary, TITLE_MAX - 12)}`;

  await sql`
    INSERT INTO complaints (customer_id, vehicle_id, complaint_type)
    VALUES (${customerId}, ${vehicle.id}, ${oneOf(a.complaint_type, COMPLAINT_TYPES, "OTHER")}::complaint_type)`;

  let recommendationId: string | null = null;
  if (outcome === "APPOINTMENT") {
    const note = `Chat triage: ${triage.summary}. Likely fault: ${fault.toLowerCase()}; fix: ${fixable.toLowerCase().replace("_", "-")}.`;
    recommendationId = await ensureRecommendation(customerId, vehicle.id, {
      type: oneOf(a.recommendation_type, recommendationTypes, "INSPECTION"),
      title,
      description: [text(a.description, 500), note].filter(Boolean).join(" "),
      priority: oneOf(a.priority, priorities, "MEDIUM"),
    });
  }

  const messageId = await postAssistantMessage(customerId, reply, { triageId: triage.id, recommendationId });
  await sql`
    UPDATE triages SET status = ${outcome}, fault = ${fault}, fixable = ${fixable}, vehicle_id = ${vehicle.id},
      recommendation_id = ${recommendationId}, concluded_message_id = ${messageId}, closed_at = clock_timestamp()
    WHERE id = ${triage.id} AND status = 'OPEN'`;

  if (recommendationId) {
    await postAssistantMessage(customerId, `Pick a time for **${title}** on ${vehicle.vehicle_number}:`, {
      kind: "BOOKING",
      recommendationId,
      triageId: triage.id,
    });
  }
}

async function applyTurn(customerId: string, ctx: CustomerContext, turn: AssistantTurn) {
  const byPlate = new Map(ctx.vehicles.map((v) => [v.vehicle_number, v]));
  const byId = new Map(ctx.vehicles.map((v) => [v.id, v]));
  // Trust the model's plate only if it's one of this customer's; a single vehicle is unambiguous.
  const vehicleFor = (plate?: string) =>
    byPlate.get(plate ?? "") ?? (ctx.vehicles.length === 1 ? ctx.vehicles[0] : undefined);
  const reply = text(turn.reply, 4000) || FALLBACK_REPLY;

  let triage = ctx.triage;
  if (!triage && turn.problem) {
    const summary = text(turn.problem.summary, 300) || "Problem reported in chat";
    triage = await openTriage(customerId, vehicleFor(turn.problem.vehicle_number)?.id ?? null, summary);
  }

  if (triage) {
    const vehicle =
      vehicleFor(turn.assessment?.vehicle_number) ?? (triage.vehicle_id ? byId.get(triage.vehicle_id) : undefined);
    const options = cleanOptions(turn.question?.options);
    const question = text(turn.question?.text, 500);
    const limitReached = triage.questions >= MAX_QUESTIONS;

    // At least one question before a verdict, and a verdict needs a known vehicle.
    if (turn.assessment && triage.questions >= 1 && vehicle) {
      return concludeTriage(customerId, triage, vehicle, turn.assessment, reply);
    }
    if (limitReached && vehicle) {
      // Five answers and still no verdict: let the workshop look rather than ask a sixth question.
      return concludeTriage(
        customerId,
        triage,
        vehicle,
        { outcome: "APPOINTMENT", priority: "MEDIUM" },
        `${reply}\n\nThanks for the details. The best next step is for our team to take a look.`,
      );
    }

    await postAssistantMessage(customerId, reply, { triageId: triage.id });
    if (question && options && !limitReached) {
      await postAssistantMessage(customerId, question, { kind: "QUESTION", options, triageId: triage.id });
    }
    return;
  }

  await postAssistantMessage(customerId, reply);

  const booking = turn.booking;
  const bookingVehicle = booking ? vehicleFor(booking.vehicle_number) : undefined;
  const service = text(booking?.service, TITLE_MAX);
  if (!booking || !bookingVehicle || !service) return;

  // Book the existing DUE appointment for this service if there is one, rather than a second.
  const [due] = (await sql`
    SELECT id FROM appointments
    WHERE customer_id = ${customerId} AND vehicle_id = ${bookingVehicle.id}
      AND status = 'DUE' AND lower(appointment_type) = lower(${service})
    LIMIT 1`) as { id: string }[];
  const target = due
    ? { appointmentId: due.id }
    : {
        recommendationId: await ensureRecommendation(customerId, bookingVehicle.id, {
          type: "SERVICE",
          title: service,
          description: "The customer asked to book this in chat.",
          priority: "MEDIUM",
        }),
      };
  await postAssistantMessage(customerId, `Pick a time for **${service}** on ${bookingVehicle.vehicle_number}:`, {
    kind: "BOOKING",
    ...target,
  });
}

/**
 * Replies to the customer's unanswered messages. Claims them first, so overlapping runs never
 * answer (or raise recommendations for) the same message twice. On failure, posts a fallback.
 */
export async function respondToCustomer(customerId: string) {
  const claimed = (await sql`
    UPDATE messages SET ai_status = 'DONE'
    WHERE customer_id = ${customerId} AND ai_status = 'PENDING'
    RETURNING id`) as { id: string }[];
  if (claimed.length === 0) return;

  const started = Date.now();
  try {
    const client = aiClient();
    if (!client) throw new Error("NVIDIA_API_KEY is not set");

    const [ctx, thread] = await Promise.all([getCustomerContext(customerId), getThread(customerId)]);
    const transcript = thread
      .slice(-HISTORY)
      .map((m) => {
        const who = m.sender === "CUSTOMER" ? "Customer" : m.sender === "ADVISOR" ? "Advisor" : "Assistant";
        return m.kind === "QUESTION"
          ? `${who} (question): ${m.body} [options: ${m.options?.join(" | ")}]`
          : `${who}: ${m.body}`;
      })
      .join("\n");
    const { name, triage, ...facts } = ctx;
    const triageLine = triage
      ? `Problem being triaged: ${triage.summary} (questions asked: ${triage.questions} of at most ${MAX_QUESTIONS}${
          triage.questions >= MAX_QUESTIONS ? "; give your assessment now" : ""
        }).`
      : "No problem is being triaged.";

    const completion = await client.chat.completions.create({
      model: aiModel(),
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Today is ${new Date().toISOString().slice(0, 10)}. Customer: ${name}.`,
            `Customer data: ${JSON.stringify({
              ...facts,
              vehicles: facts.vehicles.map((v) => ({
                vehicle_number: v.vehicle_number,
                vehicle_type: v.vehicle_type,
                fuel_type: v.fuel_type,
              })),
            })}`,
            triageLine,
            `Conversation so far:\n${transcript}`,
          ].join("\n\n"),
        },
      ],
    });
    const turn = parseJsonObject<AssistantTurn>(completion.choices[0]?.message?.content ?? "");
    await applyTurn(customerId, ctx, turn);
    console.log(`[chat] replied to ${customerId} in ${Date.now() - started}ms`);
  } catch (error) {
    console.error(`[chat] reply to ${customerId} failed after ${Date.now() - started}ms:`, error);
    await sql`UPDATE messages SET ai_status = 'FAILED' WHERE id = ANY(${claimed.map((m) => m.id)})`;
    // Mid-triage nothing is lost: the questions so far are kept, so ask for the answer again.
    const [open] = await sql`SELECT id FROM triages WHERE customer_id = ${customerId} AND status = 'OPEN'`;
    await postAssistantMessage(customerId, open ? TRIAGE_FALLBACK_REPLY : FALLBACK_REPLY, {
      triageId: (open as { id: string } | undefined)?.id ?? null,
    });
  }
}
