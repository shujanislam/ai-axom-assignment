// The slow half: the model reads visit notes for follow-ups the intervals alone would miss.
import type OpenAI from "openai";
import { priorities, recommendationTypes, type Priority } from "@/lib/format";
import { aiClient, aiModel, parseJsonObject } from "@/lib/ai";
import { TITLE_MAX, type Candidate, type VehicleContext } from "./context";

/** Vehicles per model call. Batches run in parallel, so smaller means faster. */
const AI_BATCH_SIZE = 3;

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
export async function evaluateNotes(vehicles: VehicleContext[], justAdded: Candidate[], today: string) {
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
