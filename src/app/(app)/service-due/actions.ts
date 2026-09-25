"use server";

import { refresh } from "next/cache";
import { getCurrentAdvisor } from "@/lib/server/auth";
import { sql } from "@/lib/server/db";
import { runFollowUpJob } from "@/lib/server/follow-ups";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdvisor() {
  const advisor = await getCurrentAdvisor();
  if (!advisor) throw new Error("Not signed in");
  return advisor;
}

export type ReevaluateResult = { ok: true; added: number } | { ok: false };

/** Runs the follow-up job on demand and reloads the list with whatever it added. */
export async function reevaluateServiceDue(): Promise<ReevaluateResult> {
  await requireAdvisor();
  const created = await runFollowUpJob();
  if (!created) return { ok: false };
  refresh();
  return { ok: true, added: created.length };
}

/** Accepts a follow-up and books it as a DUE appointment, in one statement. */
export async function approveFollowUp(id: string) {
  const advisor = await requireAdvisor();
  if (!UUID.test(id)) throw new Error("Invalid request");

  const rows = await sql`
    WITH approved AS (
      UPDATE recommendations
      SET advisor_action = 'APPROVED', advisor_id = ${advisor.id}
      WHERE id = ${id} AND source = 'FOLLOW_UP' AND advisor_action = 'PENDING'
      RETURNING customer_id, vehicle_id, title
    )
    INSERT INTO appointments (customer_id, vehicle_id, appointment_type, status, assigned_to)
    SELECT customer_id, vehicle_id, left(title, 100), 'DUE', ${advisor.id} FROM approved
    RETURNING id`;
  if (rows.length === 0) throw new Error("This recommendation was already handled.");
  refresh();
}
