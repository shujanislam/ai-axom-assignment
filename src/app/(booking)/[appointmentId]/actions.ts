"use server";

import { refresh } from "next/cache";
import { sql } from "@/lib/db";
import { isOfferedSlot } from "@/lib/booking/slots";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BookState = { error?: string };

/** Public: the appointment id in the emailed link is the customer's only credential. */
export async function bookSlot(appointmentId: string, slotIso: string): Promise<BookState> {
  const slot = new Date(slotIso);
  if (!UUID.test(appointmentId) || Number.isNaN(+slot) || !isOfferedSlot(slot)) {
    return { error: "That time is not available. Pick another slot." };
  }

  try {
    const rows = await sql`
      UPDATE appointments SET status = 'SCHEDULED', scheduled_at = ${slot.toISOString()}
      WHERE id = ${appointmentId} AND status = 'DUE'
      RETURNING id`;
    if (rows.length === 0) return { error: "This appointment can no longer be booked online." };
  } catch (error) {
    // appointments_scheduled_slot_idx: someone else booked this slot a moment ago.
    if ((error as { code?: string }).code === "23505") {
      refresh();
      return { error: "Someone just took that slot. Pick another one." };
    }
    throw error;
  }

  refresh();
  return {};
}
