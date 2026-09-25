"use server";

import { refresh } from "next/cache";
import { getCurrentAdvisor } from "@/lib/server/auth";
import { sql } from "@/lib/server/db";
import { priorities, recommendationTypes, type AdvisorAction } from "@/lib/format";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdvisor() {
  const advisor = await getCurrentAdvisor();
  if (!advisor) throw new Error("Not signed in");
  return advisor;
}

/** Actions an advisor can set from the review screen. */
const reviewActions: AdvisorAction[] = ["PENDING", "APPROVED", "REJECTED"];

export async function setRecommendationAction(plate: string, id: string, action: AdvisorAction) {
  const advisor = await requireAdvisor();
  if (!UUID.test(id) || !reviewActions.includes(action)) throw new Error("Invalid request");

  await sql`
    UPDATE recommendations
    SET advisor_action = ${action}::advisor_action_type,
        advisor_id = ${action === "PENDING" ? null : advisor.id}
    WHERE id = ${id}
      AND source = 'WORKSHOP'
      AND vehicle_id = (SELECT id FROM vehicles WHERE vehicle_number = ${plate})`;
  refresh();
}

export async function updateWording(plate: string, id: string, title: string, description: string) {
  await requireAdvisor();
  const cleanTitle = title.trim().slice(0, 255);
  if (!UUID.test(id) || !cleanTitle) throw new Error("A title is required");

  await sql`
    UPDATE recommendations
    SET title = ${cleanTitle}, description = ${description.trim() || null}
    WHERE id = ${id}
      AND source = 'WORKSHOP'
      AND vehicle_id = (SELECT id FROM vehicles WHERE vehicle_number = ${plate})`;
  refresh();
}

export async function skipAllPending(plate: string) {
  const advisor = await requireAdvisor();
  await sql`
    UPDATE recommendations
    SET advisor_action = 'REJECTED', advisor_id = ${advisor.id}
    WHERE advisor_action = 'PENDING'
      AND source = 'WORKSHOP'
      AND vehicle_id = (SELECT id FROM vehicles WHERE vehicle_number = ${plate})`;
  refresh();
}

export async function sendToWorkshop(plate: string) {
  const advisor = await requireAdvisor();
  await sql`
    UPDATE recommendations
    SET advisor_action = 'SCHEDULE_SERVICE', advisor_id = ${advisor.id}
    WHERE advisor_action = 'APPROVED'
      AND source = 'WORKSHOP'
      AND vehicle_id = (SELECT id FROM vehicles WHERE vehicle_number = ${plate})`;
  refresh();
}

export type ObservationState = { error?: string; ok?: number };

/** An advisor's own observation goes straight onto the job card. */
export async function addObservation(
  plate: string,
  prev: ObservationState,
  formData: FormData,
): Promise<ObservationState> {
  const advisor = await requireAdvisor();
  const title = String(formData.get("title") ?? "").trim().slice(0, 255);
  const description = String(formData.get("description") ?? "").trim();
  const type = String(formData.get("type") ?? "INSPECTION");
  const priority = String(formData.get("priority") ?? "MEDIUM");

  if (!title) return { error: "Give the observation a short title." };
  if (!(recommendationTypes as readonly string[]).includes(type) || !(priorities as string[]).includes(priority)) {
    return { error: "Pick a type and priority." };
  }

  const rows = await sql`
    INSERT INTO recommendations
      (customer_id, vehicle_id, recommendation_type, title, description, priority, advisor_id, advisor_action)
    SELECT c.customer_id, v.id, ${type}::recommendation_type, ${title}, ${description || null},
      ${priority}::recommendation_priority, ${advisor.id}, 'APPROVED'
    FROM vehicles v
    CROSS JOIN LATERAL (
      SELECT customer_id FROM appointments WHERE vehicle_id = v.id
      UNION ALL
      SELECT customer_id FROM services WHERE vehicle_id = v.id
      LIMIT 1
    ) c
    WHERE v.vehicle_number = ${plate}
    RETURNING id`;
  if (rows.length === 0) return { error: "This vehicle has no customer on record yet." };

  refresh();
  return { ok: (prev.ok ?? 0) + 1 };
}
