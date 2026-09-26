// The workshop owner's side of retention: an email about customers slipping away, and the list on
// the Today page.
import "server-only";
import { sql } from "@/lib/db";
import { sendOwnerAlertEmail, type OwnerAlertRow } from "@/lib/mail/owner-alert-email";
import { lapseLabel, reasonLabel, type LapseKind } from "./reasons";

export type LapseRow = {
  id: string;
  kind: LapseKind;
  reason: string | null;
  service: string;
  created_at: Date;
  customer_id: string;
  customer_name: string;
  phone_number: string;
  vehicle_number: string | null;
  asked: boolean;
};

const lapseRows = (where: ReturnType<typeof sql>) => sql`
  SELECT e.id, e.kind, e.reason, e.service, e.created_at, c.id AS customer_id, c.name AS customer_name,
    c.phone_number, v.vehicle_number, e.customer_notified_at IS NOT NULL AS asked
  FROM retention_events e
  JOIN customers c ON c.id = e.customer_id
  LEFT JOIN vehicles v ON v.id = e.vehicle_id
  WHERE ${where}
  ORDER BY e.created_at DESC`;

const toAlert = (r: LapseRow): OwnerAlertRow => ({
  customer: r.customer_name,
  phone: r.phone_number,
  plate: r.vehicle_number,
  service: r.service,
  what: lapseLabel[r.kind],
  reason: reasonLabel(r.reason),
});

async function ownerEmails() {
  const rows = await sql`SELECT email FROM advisors WHERE role = 'OWNER' AND email IS NOT NULL`;
  return rows.map((r) => r.email as string);
}

/**
 * Emails every owner the lapses they haven't heard about, then marks them told. With `urgentId`,
 * sends just that one straight away (a customer unhappy with their last visit). If sending fails
 * nothing is marked, so the next run tries again.
 */
export async function notifyOwners(urgentId?: string) {
  const rows = (await lapseRows(
    urgentId ? sql`e.id = ${urgentId}` : sql`e.owner_notified_at IS NULL`,
  )) as LapseRow[];
  if (rows.length === 0) return 0;
  const owners = await ownerEmails();
  if (owners.length === 0) {
    console.warn("[retention] no advisor with role OWNER has an email; owner alert not sent");
    return 0;
  }

  try {
    for (const to of owners) await sendOwnerAlertEmail(to, rows.map(toAlert), Boolean(urgentId));
  } catch (error) {
    console.error("[retention] owner alert failed:", error);
    return 0;
  }
  await sql`UPDATE retention_events SET owner_notified_at = clock_timestamp() WHERE id = ANY(${rows.map((r) => r.id)})`;
  return rows.length;
}

/** Lapses of the last two weeks, newest first, for the Today page. */
export async function getRecentLapses() {
  return (await lapseRows(sql`e.created_at > now() - interval '14 days'`)) as LapseRow[];
}
