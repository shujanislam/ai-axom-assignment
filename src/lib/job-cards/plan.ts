import "server-only";
import { sql } from "@/lib/db";
import { mechanicScore } from "@/lib/feedback/queries";
import { jobWindow, upcomingSlots, WORKSHOP_TZ } from "@/lib/booking/slots";
import { costFromLines, type InvoiceCost } from "@/lib/invoices/pricing";

// Job cards are planned when an appointment is booked: the job's text (appointment type or
// recommendation title) picks a skill from service_catalog, which says how long the job takes,
// what it costs in labour and which parts it needs. The mechanic is the most experienced one with
// that skill who is free for the whole job, then the best rated by customers, then whoever has the
// fewest jobs that day.

const HOUR_MS = 60 * 60 * 1000;
/** Postgres exclusion_violation: job_cards_mechanic_overlap rejected a double-booked mechanic. */
const OVERLAP = "23P01";
const ATTEMPTS = 3;

export type Job = { skill: string; label: string; labour_hours: number; labour_price: number };

export type JobPart = {
  part_id: string;
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  in_stock: boolean;
};

export type JobPlan = {
  skill: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** False when the job doesn't fit the workshop's hours from startsAt. */
  fitsSlot: boolean;
  mechanicId: string | null;
  parts: JobPart[];
  partsShort: boolean;
  estimate: InvoiceCost;
};

/** The catalog row for a job's text: the first pattern that matches, else GENERAL. */
export async function resolveJob(text: string) {
  const [job] = await sql`
    SELECT skill, label, labour_hours, labour_price FROM service_catalog
    WHERE skill = 'GENERAL' OR ${text} ~* match_pattern
    ORDER BY sort_order
    LIMIT 1`;
  return job as Job;
}

/**
 * True for mechanic `m` when they are active, have skill `w.skill`, and have no active job or
 * time off overlapping `w.starts_at`–`w.ends_at`. The caller provides `m` and `w`.
 */
export function mechanicIsFree() {
  return sql`
    m.active
    AND EXISTS (SELECT 1 FROM mechanic_skills ms WHERE ms.mechanic_id = m.id AND ms.skill = w.skill)
    AND NOT EXISTS (
      SELECT 1 FROM job_cards busy
      WHERE busy.mechanic_id = m.id AND busy.status IN ('ASSIGNED', 'IN_PROGRESS')
        AND tstzrange(busy.starts_at, busy.ends_at) && tstzrange(w.starts_at, w.ends_at))
    AND NOT EXISTS (
      SELECT 1 FROM mechanic_time_off off
      WHERE off.mechanic_id = m.id
        AND tstzrange(off.starts_at, off.ends_at) && tstzrange(w.starts_at, w.ends_at))`;
}

/** Offered slots where someone who can do this job is free for all of it. */
export async function getFreeSlots(text: string) {
  const job = await resolveJob(text);
  const windows = upcomingSlots()
    .map((slot) => jobWindow(slot, job.labour_hours))
    .filter((w) => w !== null);
  if (windows.length === 0) return { job, slots: [] };

  const rows = (await sql`
    SELECT w.starts_at FROM (
      SELECT starts_at, ends_at, ${job.skill}::varchar AS skill
      FROM unnest(${windows.map((w) => w.startsAt.toISOString())}::timestamptz[],
                  ${windows.map((w) => w.endsAt.toISOString())}::timestamptz[]) AS u(starts_at, ends_at)
    ) w
    WHERE EXISTS (SELECT 1 FROM mechanics m WHERE ${mechanicIsFree()})
    ORDER BY w.starts_at`) as { starts_at: string }[];
  return { job, slots: rows.map((r) => new Date(r.starts_at)) };
}

/** Plans the job card for work described by `text` starting at `startsAt`. */
export async function planJob(text: string, startsAt: Date): Promise<JobPlan> {
  const job = await resolveJob(text);
  const window = jobWindow(startsAt, job.labour_hours);
  const endsAt = window?.endsAt ?? new Date(startsAt.getTime() + job.labour_hours * HOUR_MS);

  const [mechanics, parts] = await Promise.all([
    sql`
      SELECT m.id FROM mechanics m
      CROSS JOIN (
        SELECT ${startsAt.toISOString()}::timestamptz AS starts_at, ${endsAt.toISOString()}::timestamptz AS ends_at,
          ${job.skill}::varchar AS skill
      ) w
      JOIN mechanic_skills ms ON ms.mechanic_id = m.id AND ms.skill = w.skill
      WHERE ${mechanicIsFree()}
      ORDER BY ms.level DESC,
        ${mechanicScore()} DESC,
        (SELECT count(*) FROM job_cards d
          WHERE d.mechanic_id = m.id AND d.status <> 'CANCELLED'
            AND (d.starts_at AT TIME ZONE ${WORKSHOP_TZ})::date = (w.starts_at AT TIME ZONE ${WORKSHOP_TZ})::date),
        m.name
      LIMIT 1`,
    sql`
      SELECT p.id AS part_id, p.sku, p.name, sp.qty, p.unit_price, p.stock_qty >= sp.qty AS in_stock
      FROM service_parts sp
      JOIN parts p ON p.id = sp.part_id
      WHERE sp.skill = ${job.skill}
      ORDER BY p.name`,
  ]);
  const jobParts = parts as JobPart[];

  return {
    skill: job.skill,
    title: text.slice(0, 255),
    startsAt,
    endsAt,
    fitsSlot: window !== null,
    mechanicId: (mechanics[0]?.id as string | undefined) ?? null,
    parts: jobParts,
    partsShort: jobParts.some((p) => !p.in_stock),
    estimate: costFromLines([
      { description: `${job.label} labour`, qty: 1, unitPrice: job.labour_price },
      ...jobParts.map((p) => ({ description: p.name, qty: p.qty, unitPrice: p.unit_price })),
    ]),
  };
}

/**
 * INSERT for the plan's job card, to embed as a CTE after one named `appt` that returns the
 * appointment's id, customer_id and vehicle_id. Returns the card's id; does nothing if the
 * appointment already has a card, unless it was cancelled (a missed slot being rebooked): then
 * that card is planned again.
 */
export function insertJobCard(plan: JobPlan) {
  return sql`
    INSERT INTO job_cards (appointment_id, customer_id, vehicle_id, skill, title, mechanic_id,
      starts_at, ends_at, status, parts, parts_short, estimate)
    SELECT id, customer_id, vehicle_id, ${plan.skill}, ${plan.title}, ${plan.mechanicId}::uuid,
      ${plan.startsAt.toISOString()}::timestamptz, ${plan.endsAt.toISOString()}::timestamptz,
      ${plan.mechanicId ? "ASSIGNED" : "DRAFT"}, ${JSON.stringify(plan.parts)}::jsonb, ${plan.partsShort},
      ${JSON.stringify(plan.estimate)}::jsonb
    FROM appt
    ON CONFLICT (appointment_id) DO UPDATE SET
      skill = EXCLUDED.skill, title = EXCLUDED.title, mechanic_id = EXCLUDED.mechanic_id,
      starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, status = EXCLUDED.status,
      parts = EXCLUDED.parts, parts_short = EXCLUDED.parts_short, estimate = EXCLUDED.estimate,
      updated_at = clock_timestamp()
    WHERE job_cards.status = 'CANCELLED'
    RETURNING id`;
}

const isOverlap = (error: unknown) => (error as { code?: string }).code === OVERLAP;

/**
 * Books a slot together with its job card, in the one statement `book` runs. Planning and booking
 * are separate round trips, so when the planned mechanic is taken in between, the overlap
 * constraint rejects the statement and the job is planned again. Null when nobody who can do the
 * job is free for all of it.
 */
export async function bookWithJobCard<T>(text: string, slot: Date, book: (plan: JobPlan) => Promise<T>) {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const plan = await planJob(text, slot);
    if (!plan.fitsSlot || !plan.mechanicId) return null;
    try {
      return await book(plan);
    } catch (error) {
      if (!isOverlap(error)) throw error;
    }
  }
  return null;
}

/**
 * Creates the job card for a booked appointment that has none, such as one booked before job
 * cards existed. Without a free mechanic the card is saved as DRAFT for an advisor to assign.
 * Returns the card's id (the existing one if there was a card already), or null.
 */
export async function createJobCard(appointmentId: string) {
  const [appointment] = (await sql`
    SELECT appointment_type, COALESCE(scheduled_at, now()) AS starts_at FROM appointments
    WHERE id = ${appointmentId} AND status IN ('SCHEDULED', 'CHECKED_IN')`) as {
    appointment_type: string;
    starts_at: string;
  }[];
  if (!appointment) return null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const plan = await planJob(appointment.appointment_type, new Date(appointment.starts_at));
    if (attempt === ATTEMPTS - 1) plan.mechanicId = null;
    try {
      const [card] = (await sql`
        WITH appt AS (
          SELECT id, customer_id, vehicle_id FROM appointments WHERE id = ${appointmentId}
        ), card AS (${insertJobCard(plan)})
        SELECT id FROM card
        UNION ALL
        SELECT id FROM job_cards WHERE appointment_id = ${appointmentId}
        LIMIT 1`) as { id: string }[];
      return card?.id ?? null;
    } catch (error) {
      if (!isOverlap(error)) throw error;
    }
  }
  return null;
}
