import "server-only";
import { sql } from "@/lib/db";

export type BookingAppointment = {
  id: string;
  appointment_type: string;
  status: string;
  scheduled_at: Date | null;
  customer_name: string;
  vehicle_number: string;
  vehicle_type: string | null;
};

/** What the customer's booking link shows. Only the first name leaves the database. */
export async function getBookingAppointment(id: string) {
  const [row] = await sql`
    SELECT a.id, a.appointment_type, a.status, a.scheduled_at,
      split_part(c.name, ' ', 1) AS customer_name, v.vehicle_number, v.vehicle_type
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN vehicles v ON v.id = a.vehicle_id
    WHERE a.id = ${id}`;
  return (row as BookingAppointment | undefined) ?? null;
}
