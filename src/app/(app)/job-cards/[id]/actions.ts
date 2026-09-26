"use server";

import { refresh } from "next/cache";
import { getCurrentAdvisor } from "@/lib/auth/accounts";
import { sql } from "@/lib/db";
import { mechanicIsFree } from "@/lib/job-cards/plan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdvisor() {
  if (!(await getCurrentAdvisor())) throw new Error("Not signed in");
}

/**
 * Gives an open card to another mechanic, who must have the skill and be free for its whole time.
 * A DRAFT card becomes ASSIGNED.
 */
export async function assignMechanic(jobCardId: string, mechanicId: string): Promise<{ error?: string }> {
  await requireAdvisor();
  if (!UUID.test(jobCardId) || !UUID.test(mechanicId)) throw new Error("Invalid request");

  try {
    const rows = await sql`
      UPDATE job_cards j
      SET mechanic_id = ${mechanicId}, updated_at = clock_timestamp(),
        status = CASE WHEN j.status = 'DRAFT' THEN 'ASSIGNED' ELSE j.status END
      WHERE j.id = ${jobCardId} AND j.status IN ('DRAFT', 'ASSIGNED', 'IN_PROGRESS')
        AND j.mechanic_id IS DISTINCT FROM ${mechanicId}::uuid
        AND EXISTS (
          SELECT 1 FROM mechanics m, (SELECT j.starts_at, j.ends_at, j.skill) w
          WHERE m.id = ${mechanicId} AND ${mechanicIsFree()}
        )
      RETURNING id`;
    if (rows.length === 0) return { error: "That mechanic isn’t free for this job any more." };
  } catch (error) {
    // job_cards_mechanic_overlap: they were given another job a moment ago.
    if ((error as { code?: string }).code === "23P01") return { error: "That mechanic was just booked for another job." };
    throw error;
  }
  refresh();
  return {};
}

export async function startJob(jobCardId: string): Promise<{ error?: string }> {
  await requireAdvisor();
  if (!UUID.test(jobCardId)) throw new Error("Invalid request");
  const rows = await sql`
    UPDATE job_cards SET status = 'IN_PROGRESS', updated_at = clock_timestamp()
    WHERE id = ${jobCardId} AND status = 'ASSIGNED'
    RETURNING id`;
  refresh();
  return rows.length ? {} : { error: "This job can’t be started from its current status." };
}
