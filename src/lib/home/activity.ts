// "GEAR is working": what the automations have done and are doing, read from what they already
// record (triages, job cards, retention, feedback, invoices, follow-ups), newest first.
import "server-only";
import { sql } from "@/lib/db";
import { formatSlot } from "@/lib/booking/slots";
import { humanize } from "@/lib/format";
import { formatRupees } from "@/lib/invoices/pricing";
import { lapseLabel, reasonLabel, type LapseKind } from "@/lib/retention/reasons";

/** How far back the feed looks. */
const WINDOW = "3 days";
const LIMIT = 25;

export type ActivityStatus = "WORKING" | "WAITING" | "DONE" | "ALERT";

export type Activity = {
  key: string;
  at: Date;
  status: ActivityStatus;
  title: string;
  detail: string;
  href: string;
};

const first = (name: string) => name.split(" ")[0];
/** "Black smoke from exhaust" reads as "black smoke from exhaust" mid-sentence; "AC not cooling" stays. */
const midSentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const joinDetail = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

async function triages(): Promise<Activity[]> {
  const rows = await sql`
    SELECT t.id, t.status, t.summary, t.fault, c.id AS customer_id, c.name, v.vehicle_number,
      (SELECT count(*)::int FROM messages q WHERE q.triage_id = t.id AND q.kind = 'QUESTION') AS questions,
      last.sender AS last_sender,
      CASE WHEN t.status = 'OPEN' THEN COALESCE(last.created_at, t.created_at) ELSE COALESCE(t.closed_at, t.created_at) END AS at
    FROM triages t
    JOIN customers c ON c.id = t.customer_id
    LEFT JOIN vehicles v ON v.id = t.vehicle_id
    LEFT JOIN LATERAL (
      SELECT sender, created_at FROM messages m WHERE m.customer_id = t.customer_id
      ORDER BY created_at DESC LIMIT 1
    ) last ON true
    WHERE t.status <> 'ABANDONED' AND COALESCE(t.closed_at, last.created_at, t.created_at) > now() - ${WINDOW}::interval`;
  return rows.map((r): Activity => {
    const base = { key: `triage-${r.id}`, at: r.at, href: `/messages?c=${r.customer_id}` };
    r.summary = midSentence(r.summary);
    const who = joinDetail(r.name, r.vehicle_number);
    switch (r.status) {
      case "OPEN":
        return r.last_sender === "CUSTOMER"
          ? { ...base, status: "WORKING", title: `Investigating ${r.summary}`, detail: joinDetail(who, `question ${r.questions + 1}`) }
          : { ...base, status: "WAITING", title: `Waiting for ${first(r.name)} to answer about ${r.summary}`, detail: joinDetail(who, `${r.questions} asked so far`) };
      case "CONSULT":
        return { ...base, status: "DONE", title: `Advised ${first(r.name)} on ${r.summary}`, detail: joinDetail(who, "no visit needed") };
      case "SKIPPED":
        return { ...base, status: "DONE", title: `Passed ${r.summary} to an advisor`, detail: joinDetail(who, "customer skipped the questions") };
      default:
        return {
          ...base,
          status: "DONE",
          title: `Diagnosed ${r.summary}`,
          detail: joinDetail(who, r.fault && r.fault !== "UNCLEAR" && `likely ${humanize(r.fault).toLowerCase()}`, "offered a slot"),
        };
    }
  });
}

async function jobCards(): Promise<Activity[]> {
  const rows = await sql`
    SELECT j.id, j.status, j.title, j.starts_at, j.parts_short, (j.estimate->>'total')::int AS total, j.created_at AS at,
      v.vehicle_number, m.name AS mechanic
    FROM job_cards j JOIN vehicles v ON v.id = j.vehicle_id LEFT JOIN mechanics m ON m.id = j.mechanic_id
    WHERE j.created_at > now() - ${WINDOW}::interval`;
  return rows.map((r): Activity =>
    r.status === "DRAFT"
      ? {
          key: `card-${r.id}`,
          at: r.at,
          status: "ALERT",
          title: `Couldn’t find a free mechanic for ${r.title}`,
          detail: joinDetail(r.vehicle_number, formatSlot(r.starts_at), "needs a person to assign"),
          href: `/job-cards/${r.id}`,
        }
      : {
          key: `card-${r.id}`,
          at: r.at,
          status: r.parts_short ? ("ALERT") : ("DONE"),
          title: `Prepared job card and estimate for ${r.title}`,
          detail: joinDetail(
            r.vehicle_number,
            formatRupees(r.total),
            r.mechanic && `assigned to ${first(r.mechanic)}`,
            r.parts_short && "parts to order",
          ),
          href: `/job-cards/${r.id}`,
        },
  );
}

const outcome: Record<string, string> = {
  TIMING: "offered new slots",
  PRICE: "shared the price, advisor to follow up",
  ELSEWHERE: "stopped reminders",
  CAR_FINE: "explained why it matters",
  UNHAPPY: "apologised and told the owner",
};

async function retention(): Promise<Activity[]> {
  const rows = await sql`
    SELECT e.id, e.kind, e.reason, e.service, e.customer_notified_at, e.answered_at, c.id AS customer_id, c.name,
      v.vehicle_number, a.status AS appointment_status, a.scheduled_at
    FROM retention_events e
    JOIN customers c ON c.id = e.customer_id
    LEFT JOIN vehicles v ON v.id = e.vehicle_id
    LEFT JOIN appointments a ON a.id = e.appointment_id
    WHERE e.customer_notified_at > now() - ${WINDOW}::interval OR e.answered_at > now() - ${WINDOW}::interval`;
  return rows.flatMap((r): Activity[] => {
    const href = `/messages?c=${r.customer_id}`;
    const what = lapseLabel[r.kind as LapseKind].toLowerCase();
    const asked: Activity = {
      key: `lapse-${r.id}`,
      at: r.customer_notified_at,
      status: r.reason ? "DONE" : "WAITING",
      title: `Messaged ${first(r.name)}: ${what}`,
      detail: joinDetail(r.vehicle_number, r.service, r.reason ? null : "waiting for a reply"),
      href,
    };
    if (!r.reason) return r.customer_notified_at ? [asked] : [];
    const rebooked = r.reason === "TIMING" && r.appointment_status === "SCHEDULED" && r.scheduled_at;
    return [
      ...(r.customer_notified_at ? [asked] : []),
      {
        key: `answer-${r.id}`,
        at: r.answered_at,
        status: r.reason === "UNHAPPY" ? "ALERT" : "DONE",
        title: `${first(r.name)} replied: ${reasonLabel(r.reason)?.toLowerCase()}`,
        detail: joinDetail(r.service, rebooked ? `rebooked for ${formatSlot(r.scheduled_at)}` : outcome[r.reason]),
        href,
      },
    ];
  });
}

async function feedback(): Promise<Activity[]> {
  const rows = await sql`
    SELECT f.id, f.rating, f.ai_status, f.summary, f.comment, f.created_at AS at, c.id AS customer_id, c.name,
      a.appointment_type
    FROM feedback f JOIN customers c ON c.id = f.customer_id JOIN appointments a ON a.id = f.appointment_id
    WHERE f.created_at > now() - ${WINDOW}::interval`;
  return rows.map((r): Activity => ({
    key: `feedback-${r.id}`,
    at: r.at,
    status: r.ai_status === "PENDING" ? "WORKING" : r.rating <= 2 ? "ALERT" : "DONE",
    title:
      r.ai_status === "PENDING"
        ? `Reading ${first(r.name)}’s review`
        : `Read ${first(r.name)}’s ${r.rating}-star review`,
    detail: joinDetail(r.appointment_type, r.summary ?? r.comment),
    href: `/messages?c=${r.customer_id}`,
  }));
}

async function invoices(): Promise<Activity[]> {
  const rows = await sql`
    SELECT m.id, m.created_at AS at, (i.cost->>'total')::int AS total, c.id AS customer_id, c.name, a.appointment_type
    FROM messages m
    JOIN invoices i ON i.id = m.invoice_id
    JOIN customers c ON c.id = m.customer_id
    JOIN appointments a ON a.id = m.appointment_id
    WHERE m.kind = 'INVOICE' AND m.created_at > now() - ${WINDOW}::interval`;
  return rows.map((r): Activity => ({
    key: `invoice-${r.id}`,
    at: r.at,
    status: "DONE",
    title: `Sent ${first(r.name)} the invoice for ${r.appointment_type}`,
    detail: joinDetail(formatRupees(r.total), "asked them to rate the visit"),
    href: `/messages?c=${r.customer_id}`,
  }));
}

/** Follow-ups are found in batches, so one line per run (per hour) rather than per vehicle. */
async function followUps(): Promise<Activity[]> {
  const rows = await sql`
    SELECT date_trunc('hour', created_at) AS at, count(*)::int AS n,
      (array_agg(DISTINCT title))[1:3] AS titles
    FROM recommendations
    WHERE source = 'FOLLOW_UP' AND created_at > now() - ${WINDOW}::interval
    GROUP BY 1`;
  return rows.map((r): Activity => ({
    key: `followups-${new Date(r.at).toISOString()}`,
    at: r.at,
    status: "DONE",
    title: `Found ${r.n} ${r.n === 1 ? "vehicle" : "vehicles"} due for service`,
    detail: (r.titles as string[]).join(", "),
    href: "/service-due",
  }));
}

/** Everything in progress first (it's what's live), then the rest newest first. */
export async function getActivity() {
  const all = (await Promise.all([triages(), jobCards(), retention(), feedback(), invoices(), followUps()])).flat();
  const live = (a: Activity) => (a.status === "WORKING" ? 0 : 1);
  return all.sort((a, b) => live(a) - live(b) || +new Date(b.at) - +new Date(a.at)).slice(0, LIMIT);
}
