import "server-only";
import type { InvoiceCost } from "./pricing";
import { sql } from "@/lib/db";

export type InvoiceRow = {
  id: string;
  appointment_id: string;
  cost: InvoiceCost;
  created_at: Date;
  appointment_type: string;
  vehicle_number: string;
  vehicle_type: string | null;
  customer_name: string;
  email: string | null;
  phone_number: string;
};

/** All invoices, newest first, or just the one with this id. */
async function selectInvoices(id: string | null) {
  const rows = await sql`
    SELECT i.id, i.appointment_id, i.cost, i.created_at, a.appointment_type,
      v.vehicle_number, v.vehicle_type, c.name AS customer_name, c.email, c.phone_number
    FROM invoices i
    JOIN appointments a ON a.id = i.appointment_id
    JOIN vehicles v ON v.id = a.vehicle_id
    JOIN customers c ON c.id = a.customer_id
    WHERE ${id}::uuid IS NULL OR i.id = ${id}::uuid
    ORDER BY i.created_at DESC`;
  return rows as InvoiceRow[];
}

export const getInvoices = () => selectInvoices(null);

export async function getInvoice(id: string) {
  return (await selectInvoices(id))[0] ?? null;
}
