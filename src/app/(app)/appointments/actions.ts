"use server";

import { refresh } from "next/cache";
import { completableStatuses } from "@/lib/format";
import { buildInvoiceCost, invoiceNumber, type InvoiceCost } from "@/lib/invoices/pricing";
import { getCurrentAdvisor } from "@/lib/auth/accounts";
import { sql } from "@/lib/db";
import { createJobCard } from "@/lib/job-cards/plan";
import { sendInvoiceEmail } from "@/lib/mail/invoice-email";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CompleteResult =
  { invoiceId: string; emailed: true } | { invoiceId: string; emailed: false; reason: string };

type Completed = {
  id: string;
  appointment_type: string;
  invoice_id: string;
  invoiced_at: Date;
  customer_name: string;
  email: string | null;
  vehicle_number: string;
  vehicle_type: string | null;
};

/**
 * Marks the appointment and its job card COMPLETED, records the visit in the service history and
 * saves its invoice, all in one statement, then emails the invoice. The invoice is the job card's
 * estimate, or the static price list for appointments without a card. A failed email undoes nothing.
 */
export async function completeAppointment(id: string): Promise<CompleteResult> {
  if (!(await getCurrentAdvisor())) throw new Error("Not signed in");
  if (!UUID.test(id)) throw new Error("Invalid request");

  const [appointment] = (await sql`
    SELECT a.appointment_type, j.estimate FROM appointments a
    LEFT JOIN job_cards j ON j.appointment_id = a.id AND j.status <> 'CANCELLED'
    WHERE a.id = ${id} AND a.status = ANY(${completableStatuses})`) as {
    appointment_type: string;
    estimate: InvoiceCost | null;
  }[];
  if (!appointment) throw new Error("This appointment can't be completed from its current status.");
  const cost = appointment.estimate ?? buildInvoiceCost(appointment.appointment_type);

  const [done] = (await sql`
    WITH done AS (
      UPDATE appointments SET status = 'COMPLETED'
      WHERE id = ${id} AND status = ANY(${completableStatuses})
      RETURNING id, customer_id, vehicle_id, appointment_type
    ), card AS (
      UPDATE job_cards SET status = 'COMPLETED', updated_at = clock_timestamp()
      WHERE appointment_id = (SELECT id FROM done) AND status <> 'CANCELLED'
    ), visit AS (
      INSERT INTO services (customer_id, vehicle_id, service_type, appointment_id)
      SELECT customer_id, vehicle_id, appointment_type || ' · completed', id FROM done
    ), invoice AS (
      INSERT INTO invoices (appointment_id, cost)
      SELECT id, ${JSON.stringify(cost)}::jsonb FROM done
      RETURNING id, created_at
    )
    SELECT d.id, d.appointment_type, i.id AS invoice_id, i.created_at AS invoiced_at,
      c.name AS customer_name, c.email, v.vehicle_number, v.vehicle_type
    FROM done d
    CROSS JOIN invoice i
    JOIN customers c ON c.id = d.customer_id
    JOIN vehicles v ON v.id = d.vehicle_id`) as Completed[];
  if (!done) throw new Error("This appointment was completed a moment ago.");
  refresh();

  const invoiceId = done.invoice_id;
  if (!done.email) return { invoiceId, emailed: false, reason: "no email address on file" };
  try {
    await sendInvoiceEmail({
      to: done.email,
      name: done.customer_name,
      plate: done.vehicle_number,
      vehicleType: done.vehicle_type,
      service: done.appointment_type,
      invoice: { ...cost, number: invoiceNumber(invoiceId), date: new Date(done.invoiced_at) },
    });
    return { invoiceId, emailed: true };
  } catch (error) {
    console.error(`[mail] invoice ${invoiceId} for appointment ${done.id} failed:`, error);
    return { invoiceId, emailed: false, reason: error instanceof Error ? error.message : "sending failed" };
  }
}

/** Creates the job card for a booked appointment that doesn't have one yet. Returns its id. */
export async function createAppointmentJobCard(id: string): Promise<{ jobCardId?: string; error?: string }> {
  if (!(await getCurrentAdvisor())) throw new Error("Not signed in");
  if (!UUID.test(id)) throw new Error("Invalid request");
  const jobCardId = await createJobCard(id);
  if (!jobCardId) return { error: "Only booked or checked-in appointments get a job card." };
  refresh();
  return { jobCardId };
}
