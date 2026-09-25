import OpenAI from "openai";
import { priorities, recommendationTypes, type Priority } from "../format";
import { sql } from "./db";

// NVIDIA's API is OpenAI-compatible, so the openai client just points at it.
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";

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
};

type ModelRecommendation = {
  vehicle_number: string;
  recommendation_type: string;
  title: string;
  description: string;
  priority: string;
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
        WHERE r.vehicle_id = v.id AND r.source = 'FOLLOW_UP' AND r.advisor_action = 'PENDING'
      ), '[]') AS pending_follow_ups
    FROM vehicles v
    JOIN LATERAL (
      SELECT customer_id FROM visits x WHERE x.vehicle_id = v.id ORDER BY x.created_at DESC LIMIT 1
    ) latest ON true`;
  return rows as VehicleContext[];
}

const SYSTEM_PROMPT = `You are a service advisor assistant at a car workshop in India.
For each vehicle you get its completed visits, any appointments that are still open, and
follow-up recommendations already waiting for review. Decide which owners should be
brought back for another service.

Use typical Indian service intervals (periodic service roughly every 6-12 months, AC and
brake checks around once a year, battery health for EVs and older vehicles), the time
since each kind of visit, findings mentioned in past visits, and the fuel type.

Rules:
- Skip a vehicle if nothing is due.
- Do not repeat a service that already has an open appointment or a pending follow-up.
- At most 2 recommendations per vehicle.
- "title" is the service to book, short enough to be an appointment type, e.g.
  "Periodic service", "Brake inspection", "AC service" (max 60 characters).
- "description" is one or two sentences for the advisor explaining why it is due.
- "recommendation_type" is one of: ${recommendationTypes.join(", ")}.
- "priority" is one of: ${priorities.join(", ")}.

Reply with JSON only, no prose, in exactly this shape:
{"recommendations":[{"vehicle_number":"...","recommendation_type":"SERVICE","title":"...",
"description":"...","priority":"MEDIUM"}]}
Return {"recommendations":[]} if no vehicle needs a follow-up.`;

async function askModel(vehicles: VehicleContext[]): Promise<ModelRecommendation[]> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_API_KEY is not set. Add it to .env.local.");

  // Only what the model needs to judge service intervals; no customer details leave the app.
  const input = vehicles.map((v) => ({
    vehicle_number: v.vehicle_number,
    vehicle_type: v.vehicle_type,
    fuel_type: v.fuel_type,
    completed_visits: v.completed_visits,
    open_appointments: v.open_appointments,
    pending_follow_ups: v.pending_follow_ups,
  }));

  const client = new OpenAI({ apiKey, baseURL: NVIDIA_BASE_URL });
  const completion = await client.chat.completions.create({
    model: process.env.NVIDIA_MODEL ?? DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nVehicles:\n${JSON.stringify(input)}`,
      },
    ],
  });

  const content = completion.choices[0]?.message?.content ?? "";
  // Some models wrap JSON in ```json fences or add text around it; take the outermost object.
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  try {
    return (JSON.parse(json) as { recommendations?: ModelRecommendation[] }).recommendations ?? [];
  } catch {
    throw new Error(`Model did not return valid JSON:\n${content}`);
  }
}

/**
 * Asks the model which owners need another service and stores each suggestion as a
 * PENDING FOLLOW_UP recommendation. Returns the rows actually inserted.
 */
export async function generateFollowUps(): Promise<NewFollowUp[]> {
  const vehicles = await getVehicleContext();
  if (vehicles.length === 0) return [];

  const byPlate = new Map(vehicles.map((v) => [v.vehicle_number, v]));
  const seen = new Set<string>();
  const rows = (await askModel(vehicles)).flatMap((r) => {
    const vehicle = byPlate.get(r.vehicle_number);
    const title = String(r.title ?? "").trim().slice(0, TITLE_MAX);
    const key = `${r.vehicle_number}|${title.toLowerCase()}`;
    if (
      !vehicle ||
      !title ||
      seen.has(key) ||
      !(recommendationTypes as readonly string[]).includes(r.recommendation_type) ||
      !(priorities as string[]).includes(r.priority)
    ) {
      return [];
    }
    seen.add(key);
    return [
      {
        customer_id: vehicle.customer_id,
        vehicle_id: vehicle.vehicle_id,
        recommendation_type: r.recommendation_type,
        title,
        description: String(r.description ?? "").trim() || null,
        priority: r.priority,
      },
    ];
  });
  if (rows.length === 0) return [];

  // Skips anything already waiting for review, so repeated runs don't pile up duplicates.
  const inserted = await sql`
    INSERT INTO recommendations
      (customer_id, vehicle_id, recommendation_type, title, description, priority, source)
    SELECT x.customer_id, x.vehicle_id, x.recommendation_type::recommendation_type, x.title,
      x.description, x.priority::recommendation_priority, 'FOLLOW_UP'
    FROM json_to_recordset(${JSON.stringify(rows)}::json) AS x(
      customer_id uuid, vehicle_id uuid, recommendation_type text, title text, description text, priority text)
    WHERE NOT EXISTS (
      SELECT 1 FROM recommendations r
      WHERE r.vehicle_id = x.vehicle_id AND r.source = 'FOLLOW_UP'
        AND r.advisor_action = 'PENDING' AND lower(r.title) = lower(x.title)
    )
    RETURNING (SELECT vehicle_number FROM vehicles WHERE id = vehicle_id) AS vehicle_number, title, priority`;
  return inserted as NewFollowUp[];
}

/**
 * Cron and Re-evaluate entry point. Logs what was added to the server console.
 * Returns the new recommendations, or null if the run failed.
 */
export async function runFollowUpJob(): Promise<NewFollowUp[] | null> {
  const started = Date.now();
  console.log(`[follow-ups] run started ${new Date(started).toISOString()}`);
  try {
    const created = await generateFollowUps();
    if (created.length === 0) {
      console.log("[follow-ups] no new follow-ups");
    } else {
      console.log(`[follow-ups] ${created.length} recommendation(s) added:`);
      console.table(created);
    }
    return created;
  } catch (error) {
    console.error("[follow-ups] run failed:", error);
    return null;
  } finally {
    console.log(`[follow-ups] run finished in ${Date.now() - started}ms`);
  }
}
