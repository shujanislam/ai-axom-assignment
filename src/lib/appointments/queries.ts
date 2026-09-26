import "server-only";
import { sql } from "@/lib/db";

export type Arrival = {
  vehicle_number: string;
  vehicle_type: string | null;
  fuel_type: string | null;
  customer_name: string;
  appointment_type: string;
  created_at: Date;
  advisor_name: string | null;
  open_recommendations: number;
};

export async function getArrivals() {
  const rows = await sql`
    SELECT v.vehicle_number, v.vehicle_type, v.fuel_type, c.name AS customer_name,
      a.appointment_type, a.created_at, adv.name AS advisor_name,
      (SELECT count(*)::int FROM recommendations r
        WHERE r.vehicle_id = v.id AND r.source = 'WORKSHOP' AND r.advisor_action = 'PENDING') AS open_recommendations
    FROM appointments a
    JOIN vehicles v ON v.id = a.vehicle_id
    JOIN customers c ON c.id = a.customer_id
    LEFT JOIN advisors adv ON adv.id = a.assigned_to
    WHERE a.status = 'CHECKED_IN'
    ORDER BY a.created_at`;
  return rows as Arrival[];
}

export type AppointmentRow = {
  id: string;
  vehicle_number: string;
  customer_name: string;
  appointment_type: string;
  status: string;
  advisor_name: string | null;
  created_at: Date;
  invoice_id: string | null;
  job_card_id: string | null;
  mechanic_name: string | null;
};

export async function getAppointments() {
  const rows = await sql`
    SELECT a.id, v.vehicle_number, c.name AS customer_name, a.appointment_type, a.status,
      adv.name AS advisor_name, a.created_at,
      (SELECT i.id FROM invoices i WHERE i.appointment_id = a.id ORDER BY i.created_at DESC LIMIT 1) AS invoice_id,
      j.id AS job_card_id, m.name AS mechanic_name
    FROM appointments a
    JOIN vehicles v ON v.id = a.vehicle_id
    JOIN customers c ON c.id = a.customer_id
    LEFT JOIN advisors adv ON adv.id = a.assigned_to
    LEFT JOIN job_cards j ON j.appointment_id = a.id
    LEFT JOIN mechanics m ON m.id = j.mechanic_id
    ORDER BY a.created_at DESC`;
  return rows as AppointmentRow[];
}
