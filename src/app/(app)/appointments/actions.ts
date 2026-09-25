"use server";

import { refresh } from "next/cache";
import { completableStatuses } from "@/lib/format";
import { buildInvoice } from "@/lib/invoice";
import { getCurrentAdvisor } from "@/lib/server/auth";
import { sql } from "@/lib/server/db";
import { sendInvoiceEmail } from "@/lib/server/mailer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CompleteResult = { emailed: true } | { emailed: false; reason: string };

type Completed = {
  id: string;
  appointment_type: string;
  completed_at: Date;
  customer_name: string;
  email: string | null;
  vehicle_number: string;
  vehicle_type: string | null;
};

/**
 * Marks the appointment COMPLETED and records the visit in the service history, in one
 * statement, then emails the invoice. A failed email does not undo the completion.
 */
export async function completeAppointment(id: string): Promise<CompleteResult> {
  if (!(await getCurrentAdvisor())) throw new Error("Not signed in");
  if (!UUID.test(id)) throw new Error("Invalid request");

  const [done] = (await sql`
    WITH done AS (
      UPDATE appointments SET status = 'COMPLETED'
      WHERE id = ${id} AND status = ANY(${completableStatuses})
      RETURNING id, customer_id, vehicle_id, appointment_type
    ), visit AS (
      INSERT INTO services (customer_id, vehicle_id, service_type, appointment_id)
      SELECT customer_id, vehicle_id, appointment_type || ' · completed', id FROM done
      RETURNING created_at
    )
    SELECT d.id, d.appointment_type, (SELECT created_at FROM visit) AS completed_at,
      c.name AS customer_name, c.email, v.vehicle_number, v.vehicle_type
    FROM done d
    JOIN customers c ON c.id = d.customer_id
    JOIN vehicles v ON v.id = d.vehicle_id`) as Completed[];
  if (!done) throw new Error("This appointment can't be completed from its current status.");
  refresh();

  if (!done.email) return { emailed: false, reason: "no email address on file" };
  try {
    await sendInvoiceEmail({
      to: done.email,
      name: done.customer_name,
      plate: done.vehicle_number,
      vehicleType: done.vehicle_type,
      service: done.appointment_type,
      invoice: buildInvoice(done.id, done.appointment_type, new Date(done.completed_at)),
    });
    return { emailed: true };
  } catch (error) {
    console.error(`[mail] invoice for appointment ${done.id} failed:`, error);
    return { emailed: false, reason: error instanceof Error ? error.message : "sending failed" };
  }
}
