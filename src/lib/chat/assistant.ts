// The AI assistant: replies to customers, runs problem triage (1-5 questions, then a verdict),
// and offers bookings. See constants.ts for the limits it works within.
import { bookableStatuses, priorities, recommendationTypes } from "@/lib/format";
import { aiClient, aiModel, parseJsonObject } from "@/lib/ai";
import { sql } from "@/lib/db";
import { getCustomerFeedback, type CustomerFeedback } from "@/lib/feedback/queries";
import {
  COMPLAINT_TYPES,
  FALLBACK_REPLY,
  FAULTS,
  FIXABLE,
  HISTORY,
  MAX_QUESTIONS,
  OPTION_MAX,
  TITLE_MAX,
  TRIAGE_FALLBACK_REPLY,
} from "./constants";
import { ensureRecommendation, postAssistantMessage } from "./messages";
import { getThread } from "./thread";

type Vehicle = { id: string; vehicle_number: string; vehicle_type: string | null; fuel_type: string | null };
type OpenTriage = { id: string; vehicle_id: string | null; summary: string; questions: number };

type CustomerContext = {
  name: string;
  vehicles: Vehicle[];
  visits: { vehicle_number: string; service: string; date: string }[];
  open_appointments: { vehicle_number: string; type: string; status: string; scheduled_at: string | null }[];
  suggested: { vehicle_number: string; title: string; priority: string }[];
  /** How they rated their recent visits, newest first. */
  feedback: CustomerFeedback[];
  triage: OpenTriage | null;
};

async function getCustomerContext(customerId: string): Promise<CustomerContext> {
  const [[customer], vehicles, visits, open, suggested, [triage], feedback] = await Promise.all([
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
    getCustomerFeedback(customerId),
  ]);
  return {
    name: (customer as { name: string }).name,
    vehicles: vehicles as Vehicle[],
    visits: visits as CustomerContext["visits"],
    open_appointments: open as CustomerContext["open_appointments"],
    suggested: suggested as CustomerContext["suggested"],
    feedback,
    triage: (triage as OpenTriage | undefined) ?? null,
  };
}

const SYSTEM_PROMPT = `You are the service assistant of a car workshop in India, chatting with a customer.
You get the customer's vehicles, recent visits, open appointments, services already suggested, how
they rated their recent visits (1-5 stars and what they said), any problem currently being
triaged, and the conversation so far. Answer the customer's latest message.

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

- If they rated a recent visit 3 stars or less, they were let down: be extra careful and never
  dismissive. If they bring it up, acknowledge it and say an advisor has their feedback. If a
  problem looks like it comes from that visit, lean towards fault WORKSHOP and APPOINTMENT.
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

  // Book the existing open appointment for this service if there is one, rather than a second.
  const [due] = (await sql`
    SELECT id FROM appointments
    WHERE customer_id = ${customerId} AND vehicle_id = ${bookingVehicle.id}
      AND status = ANY(${bookableStatuses}) AND lower(appointment_type) = lower(${service})
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
    if (!client) throw new Error("GEMINI_API_KEY is not set");

    const [ctx, thread] = await Promise.all([getCustomerContext(customerId), getThread(customerId)]);
    const transcript = thread
      .slice(-HISTORY)
      .map((m) => {
        const who = m.sender === "CUSTOMER" ? "Customer" : m.sender === "ADVISOR" ? "Advisor" : "Assistant";
        return m.kind === "QUESTION" || m.kind === "REASON"
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
