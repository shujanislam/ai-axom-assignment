"use server";

import { refresh } from "next/cache";
import { sql } from "@/lib/db";
import { isOfferedSlot } from "@/lib/booking/slots";
import { bookWithJobCard, insertJobCard } from "@/lib/job-cards/plan";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BookState = { error?: string };

/**
 * Public: the appointment id in the emailed link is the customer's only credential.
 * Schedules the appointment and creates its job card, with a free mechanic, in one statement.
 */
export async function bookSlot(appointmentId: string, slotIso: string): Promise<BookState> {
  const slot = new Date(slotIso);
  if (!UUID.test(appointmentId) || Number.isNaN(+slot) || !isOfferedSlot(slot)) {
    return { error: "That time is not available. Pick another slot." };
  }

  const [appointment] = (await sql`
    SELECT appointment_type FROM appointments WHERE id = ${appointmentId} AND status = 'DUE'`) as {
    appointment_type: string;
  }[];
  if (!appointment) return { error: "This appointment can no longer be booked online." };

  const booked = await bookWithJobCard(
    appointment.appointment_type,
    slot,
    (plan) => sql`
      WITH appt AS (
        UPDATE appointments SET status = 'SCHEDULED', scheduled_at = ${slot.toISOString()}
        WHERE id = ${appointmentId} AND status = 'DUE'
        RETURNING id, customer_id, vehicle_id
      ), card AS (${insertJobCard(plan)})
      SELECT id FROM appt`,
  );
  refresh();
  if (booked === null) return { error: "Someone just took that slot. Pick another one." };
  if (booked.length === 0) return { error: "This appointment can no longer be booked online." };
  return {};
}
