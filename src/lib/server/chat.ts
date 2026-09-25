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

const FALLBACK_REPLY =
  "Sorry, I couldn’t process that just now. An advisor has your message and will reply here shortly.";

// ------------------------------------------------------------------ reads

export type Sender = "CUSTOMER" | "ADVISOR" | "ASSISTANT";

export type ChatMessage = {
  id: string;
  sender: Sender;
  kind: "TEXT" | "BOOKING";
  body: string;
  created_at: Date;
  ai_status: string | null;
  advisor_name: string | null;
  appointment_status: string | null;
  scheduled_at: Date | null;
  recommendation_action: string | null;
};

export async function getThread(customerId: string) {
  const rows = await sql`
    SELECT m.id, m.sender, m.kind, m.body, m.created_at, m.ai_status, adv.name AS advisor_name,
      a.status AS appointment_status, a.scheduled_at, r.advisor_action AS recommendation_action
    FROM messages m
    LEFT JOIN advisors adv ON adv.id = m.advisor_id
    LEFT JOIN appointments a ON a.id = m.appointment_id
    LEFT JOIN recommendations r ON r.id = m.recommendation_id
    WHERE m.customer_id = ${customerId}
    ORDER BY m.created_at, m.id`;
  return rows as ChatMessage[];
}

/** What a BOOKING message can still do. */
export function bookingState(m: ChatMessage): { open: true } | { open: false; bookedAt: Date | null } {
  if (m.appointment_status === "SCHEDULED" && m.scheduled_at) return { open: false, bookedAt: m.scheduled_at };
  if (m.appointment_status === "DUE") return { open: true };
  if (m.appointment_status === null && m.recommendation_action === "PENDING") return { open: true };
  return { open: false, bookedAt: null };
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
  last_body: string;
  last_sender: Sender;
  last_at: Date;
  messages: number;
};

export async function getConversations() {
  const rows = await sql`
    SELECT c.id AS customer_id, c.name AS customer_name, last.body AS last_body,
      last.sender AS last_sender, last.created_at AS last_at, counts.n AS messages
    FROM customers c
    JOIN LATERAL (
      SELECT body, sender, created_at FROM messages m
      WHERE m.customer_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1
    ) last ON true
    JOIN LATERAL (SELECT count(*)::int AS n FROM messages m WHERE m.customer_id = c.id) counts ON true
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
  extra: { kind?: "TEXT" | "BOOKING"; recommendationId?: string | null; appointmentId?: string | null } = {},
) {
  await sql`
    INSERT INTO messages (customer_id, sender, kind, body, recommendation_id, appointment_id)
    VALUES (${customerId}, 'ASSISTANT', ${extra.kind ?? "TEXT"}, ${body.slice(0, 4000)},
      ${extra.recommendationId ?? null}, ${extra.appointmentId ?? null})`;
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
    WHERE id = ${messageId} AND customer_id = ${customerId} AND kind = 'BOOKING'`) as {
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

// -------------------------------------------------------------- assistant

type CustomerContext = {
  name: string;
  vehicles: { id: string; vehicle_number: string; vehicle_type: string | null; fuel_type: string | null }[];
  visits: { vehicle_number: string; service: string; date: string }[];
  open_appointments: { vehicle_number: string; type: string; status: string; scheduled_at: string | null }[];
  suggested: { vehicle_number: string; title: string; priority: string }[];
};

async function getCustomerContext(customerId: string): Promise<CustomerContext> {
  const [[customer], vehicles, visits, open, suggested] = await Promise.all([
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
  ]);
  return {
    name: (customer as { name: string }).name,
    vehicles: vehicles as CustomerContext["vehicles"],
    visits: visits as CustomerContext["visits"],
    open_appointments: open as CustomerContext["open_appointments"],
    suggested: suggested as CustomerContext["suggested"],
  };
}

const SYSTEM_PROMPT = `You are the service assistant of a car workshop in India, chatting with a customer.
You get the customer's vehicles, recent visits, open appointments, services the workshop already
suggested, and the conversation so far. Answer the customer's latest message.

Reply with JSON only, no prose, exactly: {"reply":"...","issue":null,"booking":null}

- "reply": what you say to the customer, in short, friendly Markdown (under 120 words; bold and
  bullet lists are fine, no tables, no code, no headings). Use the customer's language.
- "issue": when the customer reports a problem with a vehicle or a complaint about the workshop, set
  {"vehicle_number":"...","complaint_type":"${COMPLAINT_TYPES.join("|")}",
   "recommendation_type":"${recommendationTypes.join("|")}","title":"service to book, max 60 chars",
   "description":"one sentence for the advisor","priority":"${priorities.join("|")}"}
  and tell the customer an advisor will review it. Otherwise null.
- "booking": only when the customer clearly wants to book or bring the vehicle in, set
  {"vehicle_number":"...","service":"service to book, max 60 chars"} and tell them to pick a slot
  below. Otherwise null.
- vehicle_number must be one of the customer's vehicles. If it is unclear which one, ask, and set
  issue/booking to null.
- Never quote prices, promise a diagnosis, or invent dates or times: the app shows free slots.`;

type AssistantTurn = {
  reply?: string;
  issue?: {
    vehicle_number?: string;
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

async function applyTurn(customerId: string, ctx: CustomerContext, turn: AssistantTurn) {
  const byPlate = new Map(ctx.vehicles.map((v) => [v.vehicle_number, v]));
  // Trust the model's plate only if it's one of this customer's; a single vehicle is unambiguous.
  const vehicleFor = (plate?: string) =>
    byPlate.get(plate ?? "") ?? (ctx.vehicles.length === 1 ? ctx.vehicles[0] : undefined);

  let recommendationId: string | null = null;
  const issue = turn.issue;
  const issueVehicle = issue ? vehicleFor(issue.vehicle_number) : undefined;
  const issueTitle = String(issue?.title ?? "")
    .trim()
    .slice(0, TITLE_MAX);
  if (issue && issueVehicle && issueTitle) {
    await sql`
      INSERT INTO complaints (customer_id, vehicle_id, complaint_type)
      VALUES (${customerId}, ${issueVehicle.id}, ${oneOf(issue.complaint_type, COMPLAINT_TYPES, "OTHER")}::complaint_type)`;
    recommendationId = await ensureRecommendation(customerId, issueVehicle.id, {
      type: oneOf(issue.recommendation_type, recommendationTypes, "INSPECTION"),
      title: issueTitle,
      description: String(issue.description ?? "").trim() || null,
      priority: oneOf(issue.priority, priorities, "MEDIUM"),
    });
  }

  await postAssistantMessage(customerId, String(turn.reply ?? "").trim() || FALLBACK_REPLY, { recommendationId });

  const booking = turn.booking;
  const bookingVehicle = booking ? vehicleFor(booking.vehicle_number) : undefined;
  // Booking the problem just reported: reuse its recommendation, whatever the model called the
  // service, so one problem never leaves a second recommendation pending on /service-due.
  const sameProblem = recommendationId !== null && bookingVehicle?.id === issueVehicle?.id;
  const service = (sameProblem ? issueTitle : String(booking?.service ?? "").trim()).slice(0, TITLE_MAX);
  if (!booking || !bookingVehicle || !service) return;

  // Book the existing DUE appointment for this service if there is one, rather than a second.
  const [due] = (await sql`
    SELECT id FROM appointments
    WHERE customer_id = ${customerId} AND vehicle_id = ${bookingVehicle.id}
      AND status = 'DUE' AND lower(appointment_type) = lower(${service})
    LIMIT 1`) as { id: string }[];
  const target = due
    ? { appointmentId: due.id }
    : sameProblem
      ? { recommendationId }
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
      .map(
        (m) => `${m.sender === "CUSTOMER" ? "Customer" : m.sender === "ADVISOR" ? "Advisor" : "Assistant"}: ${m.body}`,
      )
      .join("\n");
    const { name, ...facts } = ctx;

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
    await postAssistantMessage(customerId, FALLBACK_REPLY);
  }
}
