import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/chat/auto-refresh";
import { ArrowRightIcon, CheckIcon, SparkIcon } from "@/components/icons";
import { Card, SectionLabel } from "@/components/ui";
import { getCurrentAdvisor } from "@/lib/auth/accounts";
import { WORKSHOP_TZ } from "@/lib/booking/slots";
import { getActivity, type Activity, type ActivityStatus } from "@/lib/home/activity";
import { getBriefing, getNeedsYou, type Briefing } from "@/lib/home/briefing";

export const metadata: Metadata = { title: "Home · gear-ai" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function greeting(now: Date) {
  const hour = Number(now.toLocaleString("en-GB", { timeZone: WORKSHOP_TZ, hour: "2-digit", hour12: false }));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** One or two plain sentences on the day, from the numbers. */
function summary(b: Briefing) {
  const day =
    b.expected === 0
      ? "No vehicles are booked in today"
      : `${plural(b.expected, "vehicle")} expected today${b.checked_in ? `, ${b.checked_in} already in` : ""}`;
  const watch = [
    b.parts_delays && `${plural(b.parts_delays, "job")} waiting on parts`,
    b.at_risk && `${plural(b.at_risk, "job")} behind schedule`,
    b.waiting_on_customers && `${plural(b.waiting_on_customers, "customer")} yet to reply`,
  ].filter(Boolean) as string[];
  const tail =
    watch.length === 0
      ? "Nothing is running late."
      : `Keep an eye on ${watch.length === 1 ? watch[0] : `${watch.slice(0, -1).join(", ")} and ${watch.at(-1)}`}.`;
  return `${day}. ${tail}`;
}

function feedTime(at: Date, now: Date) {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: WORKSHOP_TZ });
  const time = new Date(at).toLocaleTimeString("en-GB", { timeZone: WORKSHOP_TZ, hour: "2-digit", minute: "2-digit" });
  if (day(new Date(at)) === day(now)) return time;
  if (day(new Date(at)) === day(new Date(+now - 86_400_000))) return `Yesterday ${time}`;
  return `${new Date(at).toLocaleDateString("en-GB", { timeZone: WORKSHOP_TZ, weekday: "short" })} ${time}`;
}

export default async function HomePage() {
  const advisor = await getCurrentAdvisor();
  if (!advisor) redirect("/session-expired");
  const [briefing, needs, activity] = await Promise.all([getBriefing(), getNeedsYou(), getActivity()]);
  const now = new Date();
  const working = activity.filter((a) => a.status === "WORKING").length;

  const tiles: { label: string; value: string; note: string; href: string; warn: boolean }[] = [
    {
      label: "Vehicles expected",
      value: String(briefing.expected),
      note: briefing.checked_in ? `${briefing.checked_in} checked in` : "today",
      href: "/appointments",
      warn: false,
    },
    {
      label: "Waiting on customers",
      value: String(briefing.waiting_on_customers),
      note: "asked what got in the way",
      href: "/today",
      warn: briefing.waiting_on_customers > 0,
    },
    {
      label: "Likely parts delays",
      value: String(briefing.parts_delays),
      note: "parts not in stock",
      href: "/job-cards",
      warn: briefing.parts_delays > 0,
    },
    {
      label: "Jobs at risk",
      value: String(briefing.at_risk),
      note: "late, not started or unassigned",
      href: "/job-cards",
      warn: briefing.at_risk > 0,
    },
    {
      label: "Services to review",
      value: String(briefing.to_review),
      note: "suggested by GEAR",
      href: "/service-due",
      warn: false,
    },
    {
      label: "Mechanics free",
      value: `${briefing.mechanics_free}/${briefing.mechanics_total}`,
      note: `${plural(briefing.free_hours, "hour")} unbooked today`,
      href: "/job-cards",
      warn: false,
    },
  ];

  return (
    <>
      <AutoRefresh everyMs={10_000} />
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[30px] font-bold italic leading-tight tracking-[-0.03em]">
            {greeting(now)}, {advisor.name.split(" ")[0]}.
          </h1>
          <p className="mt-1 flex items-center gap-2 text-[14px] text-muted">
            <SparkIcon size={14} className="text-amber" />
            GEAR has looked over today’s workshop.
          </p>
        </div>
        <p className="text-[13px] text-muted sm:pt-3">
          {now.toLocaleDateString("en-GB", { timeZone: WORKSHOP_TZ, weekday: "long", day: "numeric", month: "long" })}
        </p>
      </header>

      <p className="mt-5 max-w-[720px] text-[17px] leading-[1.5] tracking-[-0.01em]">{summary(briefing)}</p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="group">
            <Card className="h-full p-5 transition-shadow group-hover:shadow-[0_1px_0_#e6e3dd,0_8px_24px_-12px_rgba(27,25,21,0.18)]">
              <p className={`text-[30px] font-semibold leading-none tracking-[-0.03em] tabular ${t.warn ? "text-amber-ink" : ""}`}>
                {t.value}
              </p>
              <p className="mt-2.5 text-[13.5px] font-medium">{t.label}</p>
              <p className="mt-0.5 text-[12px] text-muted">{t.note}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-3.5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section>
          <SectionLabel count={needs.length}>Needs you</SectionLabel>
          {needs.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-well px-5 py-4 text-[14px] text-muted">
              Nothing needs you right now. GEAR will put anything it can’t handle here.
            </p>
          ) : (
            <Card className="mt-3 px-5 py-1.5">
              <ul>
                {needs.map((n) => (
                  <li key={n.key} className="border-b border-line last:border-0">
                    <Link href={n.href} className="group flex items-center gap-3 py-3.5">
                      <span className={`size-2 shrink-0 rounded-full ${n.urgent ? "bg-amber" : "bg-idle"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium">{n.title}</span>
                        <span className="mt-0.5 block text-[12.5px] text-muted">{n.detail}</span>
                      </span>
                      <ArrowRightIcon size={14} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        <section>
          <h2 className="flex items-center gap-2 text-[14px] text-muted">
            GEAR is working
            {working > 0 && (
              <span className="flex items-center gap-1.5 rounded-md bg-amber-soft px-1.5 py-0.5 text-[12px] text-amber-ink">
                <span className="size-1.5 animate-pulse rounded-full bg-amber" />
                {working} live
              </span>
            )}
          </h2>
          {activity.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-well px-5 py-4 text-[14px] text-muted">
              Nothing in the last three days yet. Chats, bookings, check-ins and reviews will show up here as GEAR
              handles them.
            </p>
          ) : (
            <Card className="mt-3 px-5 py-1.5">
              <ul>
                {activity.map((a) => (
                  <FeedRow key={a.key} item={a} time={feedTime(a.at, now)} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

const statusLabel: Record<ActivityStatus, string> = {
  WORKING: "Working on it",
  WAITING: "Waiting for the customer",
  DONE: "Done",
  ALERT: "Needs a look",
};

function StatusMark({ status }: { status: ActivityStatus }) {
  const base = "grid size-6 shrink-0 place-items-center rounded-full";
  if (status === "WORKING") {
    return (
      <span className={`${base} bg-amber-soft`} aria-label={statusLabel[status]}>
        <span className="size-3 animate-spin rounded-full border-[1.5px] border-amber border-t-transparent" />
      </span>
    );
  }
  if (status === "WAITING") {
    return (
      <span className={`${base} bg-well`} aria-label={statusLabel[status]}>
        <span className="size-2 rounded-full border-[1.5px] border-subtle" />
      </span>
    );
  }
  if (status === "ALERT") {
    return (
      <span className={`${base} bg-amber-soft text-[12px] font-bold text-amber-ink`} aria-label={statusLabel[status]}>
        !
      </span>
    );
  }
  return (
    <span className={`${base} bg-leaf-soft text-leaf`} aria-label={statusLabel[status]}>
      <CheckIcon size={12} strokeWidth={2} />
    </span>
  );
}

function FeedRow({ item, time }: { item: Activity; time: string }) {
  return (
    <li className="border-b border-line last:border-0">
      <Link href={item.href} className="flex items-start gap-3 py-3">
        <StatusMark status={item.status} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[14px] ${item.status === "WORKING" ? "font-medium" : ""}`}>{item.title}</span>
          {item.detail && <span className="mt-0.5 block truncate text-[12.5px] text-muted">{item.detail}</span>}
        </span>
        <span className="shrink-0 pt-0.5 text-[12px] text-subtle tabular">
          {item.status === "WORKING" ? "now" : time}
        </span>
      </Link>
    </li>
  );
}
