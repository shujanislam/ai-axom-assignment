// Runs of the follow-up job: the instant rule pass, the AI pass, and the cron entry point.
import { evaluateNotes } from "./ai-review";
import { getVehicleContext, insertFollowUps, type Candidate, type NewFollowUp, type VehicleContext } from "./context";
import { evaluateNextDue, evaluateRules, todayInIndia } from "./rules";

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
