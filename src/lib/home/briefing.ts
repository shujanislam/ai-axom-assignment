// The home page's picture of today: the numbers at the top and the things that need a person.
import "server-only";
import { sql } from "@/lib/db";
import { WORKSHOP_TZ } from "@/lib/booking/slots";

/** Working hours a mechanic can be booked for in a day (see SLOT_HOURS in lib/booking/slots.ts). */
const HOURS_PER_DAY = 6;

export type Briefing = {
  expected: number;
  checked_in: number;
  /** Customers asked "what got in the way?" who haven't answered yet. */
  waiting_on_customers: number;
  parts_delays: number;
  at_risk: number;
  to_review: number;
  mechanics_free: number;
  mechanics_total: number;
  free_hours: number;
};

/**
 * One statement for every number. A job is at risk when it's running past its end, hasn't been
 * started half an hour after its start, or still has no mechanic and starts within a day.
 */
export async function getBriefing() {
  const [row] = await sql`
    WITH day AS (
      SELECT (now() AT TIME ZONE ${WORKSHOP_TZ})::date AS d,
        ((now() AT TIME ZONE ${WORKSHOP_TZ})::date::timestamp AT TIME ZONE ${WORKSHOP_TZ}) AS starts,
        (((now() AT TIME ZONE ${WORKSHOP_TZ})::date + 1)::timestamp AT TIME ZONE ${WORKSHOP_TZ}) AS ends
    ), on_today AS (
      SELECT m.id,
        COALESCE((SELECT sum(extract(epoch FROM least(j.ends_at, day.ends) - greatest(j.starts_at, day.starts)) / 3600)
          FROM job_cards j
          WHERE j.mechanic_id = m.id AND j.status IN ('ASSIGNED', 'IN_PROGRESS')
            AND tstzrange(j.starts_at, j.ends_at) && tstzrange(day.starts, day.ends)), 0) AS booked_hours
      FROM mechanics m CROSS JOIN day
      WHERE m.active AND NOT EXISTS (
        SELECT 1 FROM mechanic_time_off off
        WHERE off.mechanic_id = m.id AND tstzrange(off.starts_at, off.ends_at) && tstzrange(day.starts, day.ends))
    )
    SELECT
      (SELECT count(*) FROM appointments a, day
        WHERE a.status IN ('SCHEDULED', 'CHECKED_IN')
          AND (a.scheduled_at AT TIME ZONE ${WORKSHOP_TZ})::date = day.d)::int AS expected,
      (SELECT count(*) FROM appointments WHERE status = 'CHECKED_IN')::int AS checked_in,
      (SELECT count(DISTINCT customer_id) FROM retention_events
        WHERE customer_notified_at IS NOT NULL AND reason IS NULL
          AND created_at > now() - interval '14 days')::int AS waiting_on_customers,
      (SELECT count(*) FROM job_cards
        WHERE parts_short AND status IN ('DRAFT', 'ASSIGNED', 'IN_PROGRESS'))::int AS parts_delays,
      (SELECT count(*) FROM job_cards
        WHERE (status = 'IN_PROGRESS' AND ends_at < now())
           OR (status = 'ASSIGNED' AND starts_at < now() - interval '30 minutes')
           OR (status = 'DRAFT' AND starts_at < now() + interval '1 day'))::int AS at_risk,
      (SELECT count(*) FROM recommendations
        WHERE source IN ('FOLLOW_UP', 'CHAT') AND advisor_action = 'PENDING')::int AS to_review,
      (SELECT count(*) FROM on_today WHERE booked_hours < ${HOURS_PER_DAY})::int AS mechanics_free,
      (SELECT count(*) FROM mechanics WHERE active)::int AS mechanics_total,
      (SELECT COALESCE(sum(greatest(${HOURS_PER_DAY} - booked_hours, 0)), 0) FROM on_today)::int AS free_hours`;
  return row as Briefing;
}

export type NeedsYou = {
  key: string;
  title: string;
  detail: string;
  href: string;
  /** Unhappy customers and late jobs come first. */
  urgent: boolean;
};

/** What only a person can do, most urgent first. Each opens the page where it gets done. */
export async function getNeedsYou(): Promise<NeedsYou[]> {
  const [unhappy, late, noMechanic, parts, failed, [review]] = await Promise.all([
    sql`
      SELECT DISTINCT ON (c.id) c.id, c.name, c.phone_number, x.why
      FROM (
        SELECT customer_id, 'Not happy with their last visit' AS why, created_at FROM retention_events
        WHERE reason = 'UNHAPPY' AND answered_at > now() - interval '7 days'
        UNION ALL
        SELECT customer_id, 'Gave their visit ' || rating || (CASE WHEN rating = 1 THEN ' star' ELSE ' stars' END),
          created_at::timestamptz FROM feedback
        WHERE rating <= 2 AND created_at > now() - interval '7 days'
      ) x JOIN customers c ON c.id = x.customer_id
      WHERE NOT EXISTS (
        SELECT 1 FROM messages m WHERE m.customer_id = c.id AND m.sender = 'ADVISOR' AND m.created_at::timestamptz > x.created_at)
      ORDER BY c.id, x.created_at DESC`,
    sql`
      SELECT j.id, j.title, v.vehicle_number, m.name AS mechanic, j.ends_at
      FROM job_cards j JOIN vehicles v ON v.id = j.vehicle_id LEFT JOIN mechanics m ON m.id = j.mechanic_id
      WHERE j.status = 'IN_PROGRESS' AND j.ends_at < now()
      ORDER BY j.ends_at`,
    sql`
      SELECT j.id, j.title, v.vehicle_number, j.starts_at
      FROM job_cards j JOIN vehicles v ON v.id = j.vehicle_id
      WHERE j.status = 'DRAFT' ORDER BY j.starts_at`,
    sql`
      SELECT j.id, j.title, v.vehicle_number, j.starts_at,
        (SELECT string_agg(p->>'name', ', ') FROM jsonb_array_elements(j.parts) p WHERE NOT (p->>'in_stock')::boolean) AS missing
      FROM job_cards j JOIN vehicles v ON v.id = j.vehicle_id
      WHERE j.parts_short AND j.status IN ('DRAFT', 'ASSIGNED') ORDER BY j.starts_at`,
    sql`
      SELECT DISTINCT ON (c.id) c.id, c.name
      FROM messages m JOIN customers c ON c.id = m.customer_id
      WHERE m.ai_status = 'FAILED' AND m.created_at > now() - interval '2 days'
        -- Handled once an advisor replied, or the assistant answered a later message.
        AND NOT EXISTS (
          SELECT 1 FROM messages a WHERE a.customer_id = m.customer_id AND a.created_at > m.created_at
            AND (a.sender = 'ADVISOR' OR (a.sender = 'CUSTOMER' AND a.ai_status = 'DONE')))
      ORDER BY c.id, m.created_at DESC`,
    sql`
      SELECT count(*)::int AS n FROM recommendations WHERE source IN ('FOLLOW_UP', 'CHAT') AND advisor_action = 'PENDING'`,
  ]);

  const when = (d: Date) =>
    new Date(d).toLocaleString("en-GB", {
      timeZone: WORKSHOP_TZ,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  const items: NeedsYou[] = [
    ...unhappy.map((r) => ({
      key: `unhappy-${r.id}`,
      title: `Call ${r.name}: ${String(r.why).toLowerCase()}`,
      detail: `${r.phone_number} · GEAR told them someone will be in touch`,
      href: `/messages?c=${r.id}`,
      urgent: true,
    })),
    ...late.map((r) => ({
      key: `late-${r.id}`,
      title: `${r.title} on ${r.vehicle_number} is running late`,
      detail: `${r.mechanic ?? "Unassigned"} · was due to finish ${when(r.ends_at)}`,
      href: `/job-cards/${r.id}`,
      urgent: true,
    })),
    ...noMechanic.map((r) => ({
      key: `draft-${r.id}`,
      title: `Pick a mechanic for ${r.title}`,
      detail: `${r.vehicle_number} · ${when(r.starts_at)} · nobody with the skill was free`,
      href: `/job-cards/${r.id}`,
      urgent: false,
    })),
    ...parts.map((r) => ({
      key: `parts-${r.id}`,
      title: `Order ${r.missing ?? "parts"}`,
      detail: `For ${r.title} on ${r.vehicle_number} · starts ${when(r.starts_at)}`,
      href: `/job-cards/${r.id}`,
      urgent: false,
    })),
    ...failed.map((r) => ({
      key: `failed-${r.id}`,
      title: `Reply to ${r.name}`,
      detail: "The assistant couldn’t answer their last message",
      href: `/messages?c=${r.id}`,
      urgent: false,
    })),
  ];
  const n = (review as { n: number }).n;
  if (n > 0) {
    items.push({
      key: "review",
      title: `Review ${n} suggested ${n === 1 ? "service" : "services"}`,
      detail: "Found by GEAR from service dates, intervals and visit notes",
      href: "/service-due",
      urgent: false,
    });
  }
  return items.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}
