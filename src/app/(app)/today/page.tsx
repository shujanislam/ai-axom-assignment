import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { Card, PageHeader, SectionLabel, Tag } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getArrivals } from "@/lib/appointments/queries";
import { getRecentLapses } from "@/lib/retention/owner";
import { lapseLabel, reasonLabel } from "@/lib/retention/reasons";

export const metadata: Metadata = { title: "Today · gear-ai" };

export default async function TodayPage() {
  const [arrivals, lapses] = await Promise.all([getArrivals(), getRecentLapses()]);

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={`${arrivals.length} ${arrivals.length === 1 ? "vehicle" : "vehicles"} checked in`}
      />

      {arrivals.length === 0 ? (
        <Card className="mt-6 grid min-h-[240px] place-items-center p-10 text-[14px] text-muted">
          No vehicles are checked in right now.
        </Card>
      ) : (
        <div className="mt-6 grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {arrivals.map((a) => (
            <Link key={a.vehicle_number} href={`/vehicles/${a.vehicle_number}`} className="group">
              <Card className="h-full p-6 transition-shadow group-hover:shadow-[0_1px_0_#e6e3dd,0_8px_24px_-12px_rgba(27,25,21,0.18)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[18px] font-semibold tracking-[-0.02em]">{a.vehicle_number}</h2>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {[a.vehicle_type, a.fuel_type].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {a.open_recommendations > 0 && <Tag>{a.open_recommendations} to review</Tag>}
                </div>
                <dl className="mt-5 space-y-1.5 text-[13.5px]">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Customer</dt>
                    <dd className="font-medium">{a.customer_name}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Appointment</dt>
                    <dd className="font-medium">{a.appointment_type}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Advisor</dt>
                    <dd className="font-medium">{a.advisor_name ?? "Unassigned"}</dd>
                  </div>
                </dl>
                <p className="mt-5 flex items-center justify-between border-t border-line pt-4 text-[12.5px] text-muted">
                  Booked {formatDateTime(a.created_at)}
                  <ArrowRightIcon size={14} className="text-ink transition-transform group-hover:translate-x-0.5" />
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-10">
        <SectionLabel count={lapses.length}>Customers slipping away</SectionLabel>
      </div>
      {lapses.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-well px-5 py-4 text-[14px] text-muted">
          Nobody has missed a slot, skipped a booking or let a service date pass in the last two weeks.
        </p>
      ) : (
        <Card className="mt-3 px-6 py-2">
          <ul>
            {lapses.map((l) => (
              <li key={l.id} className="border-b border-line last:border-0">
                <Link
                  href={`/messages?c=${l.customer_id}`}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">
                      {l.customer_name}
                      <span className="ml-2 font-normal text-muted">
                        {[l.vehicle_number, l.phone_number].filter(Boolean).join(" · ")}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      {lapseLabel[l.kind]} · {l.service} · {formatDateTime(l.created_at)}
                    </p>
                  </div>
                  {l.reason ? (
                    <Tag
                      className={l.reason === "UNHAPPY" || l.reason === "PRICE" ? "bg-amber-soft text-amber-ink" : ""}
                    >
                      {reasonLabel(l.reason)}
                    </Tag>
                  ) : (
                    <span className="text-[12.5px] text-subtle">
                      {l.asked ? "Asked, no answer yet" : "Not asked: already in touch"}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
