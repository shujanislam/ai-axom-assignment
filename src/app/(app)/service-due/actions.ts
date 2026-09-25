"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { after } from "next/server";
import { getCurrentAdvisor } from "@/lib/server/auth";
import { sql } from "@/lib/server/db";
import { runAiPass, runRulePass } from "@/lib/server/follow-ups";
import { sendServiceDueEmail } from "@/lib/server/mailer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdvisor() {
  const advisor = await getCurrentAdvisor();
  if (!advisor) throw new Error("Not signed in");
  return advisor;
}

/** APP_URL if set, otherwise the host this request came in on (e.g. http://localhost:3001). */
async function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export type ReevaluateResult = { ok: true; added: number; aiQueued: boolean } | { ok: false };

/**
 * Adds interval-based follow-ups right away, then lets the model review visit notes after the
 * response is sent. Its findings show up on the next page load.
 */
export async function reevaluateServiceDue(): Promise<ReevaluateResult> {
  await requireAdvisor();
  const rules = await runRulePass();
  if (!rules) return { ok: false };
  const aiQueued = Boolean(process.env.NVIDIA_API_KEY);
  if (aiQueued) after(() => runAiPass(rules));
  refresh();
  return { ok: true, added: rules.created.length, aiQueued };
}

export type ApproveResult = { customer: string; emailed: true } | { customer: string; emailed: false; reason: string };

type Booked = {
  appointment_id: string;
  appointment_type: string;
  description: string | null;
  customer_name: string;
  email: string | null;
  vehicle_number: string;
  vehicle_type: string | null;
};

/**
 * Accepts a follow-up and books it as a DUE appointment in one statement, then emails the
 * customer a link to pick a slot. A failed email does not undo the approval.
 */
export async function approveFollowUp(id: string): Promise<ApproveResult> {
  const advisor = await requireAdvisor();
  if (!UUID.test(id)) throw new Error("Invalid request");

  const [booked] = (await sql`
    WITH approved AS (
      UPDATE recommendations
      SET advisor_action = 'APPROVED', advisor_id = ${advisor.id}
      WHERE id = ${id} AND source = 'FOLLOW_UP' AND advisor_action = 'PENDING'
      RETURNING customer_id, vehicle_id, title, description
    ), inserted AS (
      INSERT INTO appointments (customer_id, vehicle_id, appointment_type, status, assigned_to)
      SELECT customer_id, vehicle_id, left(title, 100), 'DUE', ${advisor.id} FROM approved
      RETURNING id, customer_id, vehicle_id, appointment_type
    )
    SELECT i.id AS appointment_id, i.appointment_type, (SELECT description FROM approved) AS description,
      c.name AS customer_name, c.email, v.vehicle_number, v.vehicle_type
    FROM inserted i
    JOIN customers c ON c.id = i.customer_id
    JOIN vehicles v ON v.id = i.vehicle_id`) as Booked[];
  if (!booked) throw new Error("This recommendation was already handled.");
  refresh();

  const customer = booked.customer_name;
  if (!booked.email) return { customer, emailed: false, reason: "no email address on file" };
  try {
    await sendServiceDueEmail({
      to: booked.email,
      name: booked.customer_name,
      plate: booked.vehicle_number,
      vehicleType: booked.vehicle_type,
      service: booked.appointment_type,
      description: booked.description,
      link: `${await appUrl()}/${booked.appointment_id}`,
    });
    return { customer, emailed: true };
  } catch (error) {
    console.error(`[mail] service-due email for appointment ${booked.appointment_id} failed:`, error);
    return { customer, emailed: false, reason: error instanceof Error ? error.message : "sending failed" };
  }
}
