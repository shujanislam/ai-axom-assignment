import "server-only";
import { cache } from "react";
import { sql } from "@/lib/db";

export type VehicleDetail = {
  id: string;
  vehicle_number: string;
  vehicle_type: string | null;
  fuel_type: string | null;
  registration_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  preferred_language: string | null;
  appointment_type: string | null;
  appointment_status: string | null;
  appointment_at: Date | null;
  advisor_name: string | null;
};

export type ServiceRow = { id: string; service_type: string; created_at: Date; appointment_type: string | null };
export type ComplaintRow = { id: string; complaint_type: string; created_at: Date };

/** Vehicle with its latest appointment and that appointment's customer. */
export const getVehicle = cache(async (plate: string) => {
  const rows = await sql`
    SELECT v.id, v.vehicle_number, v.vehicle_type, v.fuel_type, v.registration_number,
      c.id AS customer_id, c.name AS customer_name, c.phone_number AS customer_phone,
      c.email AS customer_email, c.preferred_language,
      a.appointment_type, a.status AS appointment_status, a.created_at AS appointment_at,
      adv.name AS advisor_name
    FROM vehicles v
    LEFT JOIN LATERAL (
      SELECT * FROM appointments WHERE vehicle_id = v.id ORDER BY created_at DESC LIMIT 1
    ) a ON true
    LEFT JOIN customers c ON c.id = coalesce(
      a.customer_id,
      (SELECT customer_id FROM services WHERE vehicle_id = v.id ORDER BY created_at DESC LIMIT 1)
    )
    LEFT JOIN advisors adv ON adv.id = a.assigned_to
    WHERE v.vehicle_number = ${plate}`;
  return (rows[0] as VehicleDetail | undefined) ?? null;
});

export async function getServiceHistory(vehicleId: string) {
  const rows = await sql`
    SELECT s.id, s.service_type, s.created_at, a.appointment_type
    FROM services s
    LEFT JOIN appointments a ON a.id = s.appointment_id
    WHERE s.vehicle_id = ${vehicleId}
    ORDER BY s.created_at DESC`;
  return rows as ServiceRow[];
}

export async function getComplaints(vehicleId: string) {
  const rows = await sql`
    SELECT id, complaint_type, created_at FROM complaints
    WHERE vehicle_id = ${vehicleId}
    ORDER BY created_at DESC`;
  return rows as ComplaintRow[];
}
