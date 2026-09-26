import type OpenAI from "openai";
import { formatDate, priorities, recommendationTypes, type Priority } from "../format";
import { aiClient, aiModel, parseJsonObject } from "./ai";
import { sql } from "./db";

/** Vehicles per model call. Batches run in parallel, so smaller means faster. */
const AI_BATCH_SIZE = 3;

/** Titles become appointments.appointment_type on approval, which is VARCHAR(100). */
const TITLE_MAX = 100;

type VehicleContext = {
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

type Candidate = {
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
async function getVehicleContext() {
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
async function insertFollowUps(rows: Candidate[]) {
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

// ------------------------------------------------------------------ rules

/** Service intervals the workshop follows. A vehicle is only checked for a kind it has had before. */
const SERVICE_RULES = [
  { title: "Periodic service", type: "SERVICE", label: "periodic service", months: 12, match: /periodic/i },
  { title: "AC service", type: "SERVICE", label: "AC service", months: 12, match: /\bac\b|air.?con/i },
  { title: "Brake inspection", type: "INSPECTION", label: "brake service", months: 12, match: /brake/i },
  { title: "Battery health check", type: "INSPECTION", label: "battery check", months: 12, match: /battery/i },
] as const;

type Rule = (typeof SERVICE_RULES)[number];

/** Which rule a visit or appointment belongs to, judged by its service name (the part before "·"). */
function ruleFor(text: string): Rule | undefined {
  const name = text.split("·")[0];
  return SERVICE_RULES.find((r) => r.match.test(name));
}

function todayInIndia() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

function monthsBetween(from: string, to: string) {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

function overduePriority(monthsOver: number): Priority {
  if (monthsOver < 0) return "LOW"; // due within the month
  if (monthsOver < 3) return "MEDIUM";
  if (monthsOver < 6) return "HIGH";
  return "URGENT";
}

/** Services not yet booked or suggested for this vehicle, by rule title. */
function alreadyPlanned(v: VehicleContext) {
  return new Set(
    [...v.open_appointments.map((a) => a.type), ...v.pending_follow_ups]
      .map((t) => ruleFor(t)?.title ?? t)
      .map((t) => t.toLowerCase()),
  );
}

/** Vehicles whose next service date (set at the last visit) is this close, or already past, come back. */
const NEXT_DUE_WINDOW_DAYS = 30;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function nextDuePriority(daysLeft: number): Priority {
  if (daysLeft < -30) return "URGENT";
  if (daysLeft < 0) return "HIGH";
  if (daysLeft <= 7) return "MEDIUM";
  return "LOW";
}

/** Follow-ups from services.next_appointment_date: the date the workshop set at the last visit. */
function evaluateNextDue(vehicles: VehicleContext[], today: string): Candidate[] {
  return vehicles.flatMap((v) => {
    if (!v.next_due) return [];
    const daysLeft = daysBetween(today, v.next_due.date);
    if (daysLeft > NEXT_DUE_WINDOW_DAYS) return [];

    const name = v.next_due.service.split("·")[0].trim();
    const rule = ruleFor(name);
    const title = (rule?.title ?? name) || "Periodic service";
    if (alreadyPlanned(v).has(title.toLowerCase())) return [];

    const when =
      daysLeft > 1
        ? `in ${daysLeft} days`
        : daysLeft === 1
          ? "tomorrow"
          : daysLeft === 0
            ? "today"
            : `${-daysLeft} day${daysLeft === -1 ? "" : "s"} ago`;
    return [
      {
        customer_id: v.customer_id,
        vehicle_id: v.vehicle_id,
        vehicle_number: v.vehicle_number,
        recommendation_type: rule?.type ?? "SERVICE",
        title: title.slice(0, TITLE_MAX),
        description: `Next service was set for ${formatDate(v.next_due.date)} (${when}) at the visit on ${formatDate(v.next_due.visit)}.`,
        priority: nextDuePriority(daysLeft),
        origin: "next_due" as const,
      },
    ];
  });
}

/** Interval-based follow-ups, worked out in code: instant and deterministic. */
function evaluateRules(vehicles: VehicleContext[], today: string): Candidate[] {
  return vehicles.flatMap((v) => {
    const planned = alreadyPlanned(v);
    // A next date set at the last visit is the workshop's own plan; it replaces the rule of thumb.
    const plannedByDate = v.next_due ? ruleFor(v.next_due.service) : undefined;
    return SERVICE_RULES.flatMap((rule) => {
      const last = v.completed_visits.find((visit) => ruleFor(visit.service) === rule); // newest first
      if (!last || rule === plannedByDate || planned.has(rule.title.toLowerCase())) return [];

      const months = monthsBetween(last.date, today);
      if (months < rule.months - 1) return [];

      const when = `${months} months ago (${formatDate(last.date)})`;
      return [
        {
          customer_id: v.customer_id,
          vehicle_id: v.vehicle_id,
          recommendation_type: rule.type,
          title: rule.title,
          description:
            months >= rule.months
              ? `Last ${rule.label} was ${when}; it is due every ${rule.months} months.`
              : `Last ${rule.label} was ${when}; it falls due within the next month.`,
          priority: overduePriority(months - rule.months),
        },
      ];
    });
  });
}

// --------------------------------------------------------------------- AI

/** Visit notes that suggest a follow-up the intervals alone would miss. */
const FINDING = /recheck|advis|declin|worn|nois|leak|review|slipp|left|within|soon/i;

const SYSTEM_PROMPT = `You are a service advisor assistant at a car workshop in India.
Regular service intervals are already handled. Your only job is to read the notes from past
visits and spot follow-ups they call for: a part to recheck, a test that was advised, a repair
the customer declined, wear that will need attention. Use the visit dates and today's date.

Rules:
- Skip anything listed in "already_planned".
- Skip findings that were clearly resolved by a later visit.
- At most 1 recommendation per vehicle, only when the note justifies it.
- "title" is the service to book, max 60 characters, e.g. "Brake inspection", "CNG kit leak test".
- "description" is one sentence for the advisor quoting the finding and its date.
- "recommendation_type" is one of: ${recommendationTypes.join(", ")}.
- "priority" is one of: ${priorities.join(", ")}.

Reply with JSON only, no prose:
{"recommendations":[{"vehicle_number":"...","recommendation_type":"INSPECTION","title":"...",
"description":"...","priority":"MEDIUM"}]}
Return {"recommendations":[]} if no note calls for a follow-up.`;

type ModelRecommendation = {
  vehicle_number: string;
  recommendation_type: string;
  title: string;
  description: string;
  priority: string;
};

async function askModel(client: OpenAI, input: object[], today: string): Promise<ModelRecommendation[]> {
  const completion = await client.chat.completions.create({
    model: aiModel(),
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Today is ${today}.\n\nVehicles:\n${JSON.stringify(input)}` },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "";
  return parseJsonObject<{ recommendations?: ModelRecommendation[] }>(content).recommendations ?? [];
}

function toCandidate(r: ModelRecommendation, byPlate: Map<string, VehicleContext>): Candidate | null {
  const vehicle = byPlate.get(r.vehicle_number);
  const title = String(r.title ?? "")
    .trim()
    .slice(0, TITLE_MAX);
  if (
    !vehicle ||
    !title ||
    !(recommendationTypes as readonly string[]).includes(r.recommendation_type) ||
    !(priorities as string[]).includes(r.priority)
  ) {
    return null;
  }
  return {
    customer_id: vehicle.customer_id,
    vehicle_id: vehicle.vehicle_id,
    recommendation_type: r.recommendation_type,
    title,
    description: String(r.description ?? "").trim() || null,
    priority: r.priority as Priority,
  };
}

/** Model review of visit notes, in small parallel batches. Skips vehicles with nothing noted. */
async function evaluateNotes(vehicles: VehicleContext[], justAdded: Candidate[], today: string) {
  const client = aiClient();
  if (!client) {
    console.warn("[follow-ups] NVIDIA_API_KEY is not set; skipping the AI review of visit notes");
    return [];
  }

  const added = new Map<string, string[]>();
  for (const c of justAdded) added.set(c.vehicle_id, [...(added.get(c.vehicle_id) ?? []), c.title]);

  const input = vehicles
    .filter((v) => v.completed_visits.some((visit) => FINDING.test(visit.service.split("·")[1] ?? "")))
    .map((v) => ({
      vehicle_number: v.vehicle_number,
      vehicle_type: v.vehicle_type,
      fuel_type: v.fuel_type,
      visits: v.completed_visits,
      already_planned: [
        ...v.open_appointments.map((a) => a.type),
        ...v.pending_follow_ups,
        ...(added.get(v.vehicle_id) ?? []),
      ],
    }));
  if (input.length === 0) return [];

  const batches = Array.from({ length: Math.ceil(input.length / AI_BATCH_SIZE) }, (_, i) =>
    input.slice(i * AI_BATCH_SIZE, (i + 1) * AI_BATCH_SIZE),
  );
  const results = await Promise.allSettled(batches.map((batch) => askModel(client, batch, today)));

  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[follow-ups] AI batch ${i + 1}/${batches.length} failed:`, r.reason);
  });
  if (results.every((r) => r.status === "rejected")) throw new Error("Every AI batch failed");

  const byPlate = new Map(vehicles.map((v) => [v.vehicle_number, v]));
  return results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .flatMap((r) => toCandidate(r, byPlate) ?? []);
}

// ------------------------------------------------------------------ runs

export type RulePass = {
  created: NewFollowUp[];
  /** Of `created`, how many came from a next service date coming up (or passed). */
  dueSoon: number;
  vehicles: VehicleContext[];
  candidates: Candidate[];
};

/** Instant pass: next service dates, then interval rules. Returns null if it failed. */
export async function runRulePass(): Promise<RulePass | null> {
  const started = Date.now();
  try {
    const vehicles = await getVehicleContext();
    const today = todayInIndia();
    // Next dates first, so if both suggest the same service the dated one (with its reason) wins.
    const seen = new Set<string>();
    const candidates = [...evaluateNextDue(vehicles, today), ...evaluateRules(vehicles, today)].filter((c) => {
      const key = `${c.vehicle_id}|${c.title.toLowerCase()}`;
      return !seen.has(key) && seen.add(key);
    });
    const created = await insertFollowUps(candidates);

    const dated = new Set(
      candidates.filter((c) => c.origin === "next_due").map((c) => `${c.vehicle_number}|${c.title}`),
    );
    const dueSoon = created.filter((c) => dated.has(`${c.vehicle_number}|${c.title}`)).length;
    console.log(
      `[follow-ups] rules: ${created.length} added (${dueSoon} from next service dates) in ${Date.now() - started}ms`,
    );
    if (created.length) console.table(created);
    return { created, dueSoon, vehicles, candidates };
  } catch (error) {
    console.error("[follow-ups] rule pass failed:", error);
    return null;
  }
}

// One AI review at a time, so repeated clicks don't pile up slow requests.
const globalForAi = globalThis as unknown as { followUpAiRunning?: boolean };

/** Slow pass: model review of visit notes. Returns what it added, or null if it failed or was skipped. */
export async function runAiPass(rules: RulePass): Promise<NewFollowUp[] | null> {
  if (globalForAi.followUpAiRunning) {
    console.log("[follow-ups] AI review already running; skipped");
    return null;
  }
  globalForAi.followUpAiRunning = true;
  const started = Date.now();
  try {
    const candidates = await evaluateNotes(rules.vehicles, rules.candidates, todayInIndia());
    const created = await insertFollowUps(candidates);
    console.log(`[follow-ups] AI: ${created.length} added in ${Date.now() - started}ms`);
    if (created.length) console.table(created);
    return created;
  } catch (error) {
    console.error(`[follow-ups] AI review failed after ${Date.now() - started}ms:`, error);
    return null;
  } finally {
    globalForAi.followUpAiRunning = false;
  }
}

/** Cron entry point: rules, then the AI review. */
export async function runFollowUpJob() {
  const rules = await runRulePass();
  if (rules) await runAiPass(rules);
}
