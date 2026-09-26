import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRightIcon } from "@/components/icons";
import { ButtonLink, Card, Dot, Row, SectionLabel, Tag } from "@/components/ui";
import { VehicleBlueprint } from "@/components/vehicle-blueprint";
import {
  bodyTypeFor,
  daysSince,
  formatDate,
  formatDateTime,
  humanize,
  onJobCard,
  splitServiceType,
  statusMeta,
} from "@/lib/format";
import { getComplaints, getServiceHistory, getVehicle } from "@/lib/vehicles/queries";
import { getLatestJobCardId, getRecommendations } from "@/lib/job-cards/queries";

export async function generateMetadata({ params }: PageProps<"/vehicles/[plate]">): Promise<Metadata> {
  const { plate } = await params;
  return { title: `${decodeURIComponent(plate)} · gear-ai` };
}

const BRAKE = /brake/i;
const AC = /\bac\b|air.?con|refrigerant|cabin cooling/i;

export default async function VehiclePage({ params }: PageProps<"/vehicles/[plate]">) {
  const plate = decodeURIComponent((await params).plate);
  const vehicle = await getVehicle(plate);
  if (!vehicle) notFound();

  const [services, complaints, recommendations, jobCardId] = await Promise.all([
    getServiceHistory(vehicle.id),
    getComplaints(vehicle.id),
    getRecommendations(vehicle.id),
    getLatestJobCardId(vehicle.id),
  ]);

  const open = recommendations.filter((r) => r.advisor_action === "PENDING" || onJobCard.includes(r.advisor_action));
  const pending = recommendations.filter((r) => r.advisor_action === "PENDING").length;
  const onCard = recommendations.filter((r) => onJobCard.includes(r.advisor_action)).length;
  const mentions = (re: RegExp) => open.some((r) => re.test(`${r.title} ${r.description ?? ""}`));

  const status = vehicle.appointment_status ? statusMeta(vehicle.appointment_status) : null;
  const lastService = services[0];

  const stats = [
    {
      label: "Visits on record",
      value: services.length,
      unit: services.length === 1 ? "visit" : "visits",
      note: lastService ? `Last on ${formatDate(lastService.created_at)}` : "No service history",
    },
    {
      label: "Days since last service",
      value: lastService ? daysSince(lastService.created_at) : "—",
      unit: lastService ? "days" : "",
      note: lastService ? splitServiceType(lastService.service_type).title : "Never serviced here",
    },
    {
      label: "Recommendations to review",
      value: pending,
      unit: "open",
      note: `${onCard} on the job card`,
      flagged: pending > 0,
    },
    {
      label: "Complaints",
      value: complaints.length,
      unit: "logged",
      note: complaints[0] ? `Latest ${formatDate(complaints[0].created_at)}` : "None logged",
      flagged: complaints.length > 0,
    },
  ];

  const subtitle = [
    vehicle.vehicle_type,
    vehicle.fuel_type?.toLowerCase(),
    status && vehicle.appointment_at ? `${status.label.toLowerCase()} · booked ${formatDateTime(vehicle.appointment_at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[28px] font-bold italic leading-tight tracking-[-0.03em]">{vehicle.vehicle_number}</h1>
          <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2.5">
          {jobCardId && (
            <ButtonLink href={`/job-cards/${jobCardId}`} variant="secondary">
              Job card
            </ButtonLink>
          )}
          <ButtonLink href={`/vehicles/${vehicle.vehicle_number}/review`} icon={<ArrowRightIcon size={15} />}>
            Review suggestions
          </ButtonLink>
        </div>
      </header>

      <div className="mt-6 grid gap-3.5 xl:grid-cols-[1.12fr_1fr]">
        <VehicleBlueprint
          plate={vehicle.vehicle_number}
          bodyType={bodyTypeFor(vehicle.vehicle_type)}
          flags={{ brake: mentions(BRAKE), ac: mentions(AC) }}
        />

        <div className="grid gap-3.5 sm:grid-cols-2">
          {stats.map((s) => (
            <Card key={s.label} className="relative px-6 pb-6 pt-6">
              {s.flagged && <Dot tone="amber" className="absolute right-7 top-7" />}
              <p className="pr-4 text-[13px] text-muted">{s.label}</p>
              <p className="mt-2.5 flex items-baseline gap-1.5">
                <span className="text-[36px] font-semibold leading-none tracking-[-0.045em] tabular">{s.value}</span>
                <span className="text-[14px] text-subtle">{s.unit}</span>
              </p>
              <p className="mt-3 text-[12px] text-muted">{s.note}</p>
            </Card>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3.5 xl:grid-cols-[1fr_1.33fr]">
        <Card className="p-6">
          <SectionLabel>
            Customer {vehicle.preferred_language && <Tag>{vehicle.preferred_language}</Tag>}
          </SectionLabel>

          {complaints.length > 0 ? (
            <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
              {complaints.map((c, i) => (
                <div key={c.id} className="rounded-2xl bg-[#f8f7f5] px-5 py-4">
                  <p className="text-[12px] text-muted">
                    Complaint {i + 1} · {formatDate(c.created_at)}
                  </p>
                  <p className="mt-1 text-[14px] font-medium">{humanize(c.complaint_type)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3.5 rounded-2xl bg-well px-5 py-4 text-[13.5px] text-muted">No complaints logged.</p>
          )}

          <dl className="mt-4 border-t border-line pt-3">
            <Row label="Customer" value={vehicle.customer_name ?? "—"} />
            <Row label="Phone" value={vehicle.customer_phone ?? "—"} />
            <Row label="Email" value={vehicle.customer_email ?? "—"} />
            <Row
              label="Appointment"
              value={vehicle.appointment_type ? `${vehicle.appointment_type} · ${status?.label}` : "None"}
            />
            <Row label="Assigned advisor" value={vehicle.advisor_name ?? "Unassigned"} />
            <Row label="Registration" value={vehicle.registration_number ?? "—"} />
          </dl>
        </Card>

        <Card className="p-6">
          <SectionLabel>
            Service history <Tag>{services.length} visits</Tag>
          </SectionLabel>
          {services.length > 0 ? (
            <ol className="mt-3 space-y-5">
              {services.map((s) => {
                const { title, detail } = splitServiceType(s.service_type);
                return (
                  <li key={s.id} className="grid grid-cols-[14px_1fr_auto] gap-x-2.5">
                    <Dot tone={BRAKE.test(s.service_type) || AC.test(s.service_type) ? "amber" : "idle"} className="mt-3" />
                    <div>
                      <p className="text-[14px] font-semibold">{title}</p>
                      {(detail || s.appointment_type) && (
                        <p className="mt-0.5 text-[13.5px] text-muted">{detail || s.appointment_type}</p>
                      )}
                    </div>
                    <p className="text-[12px] text-muted tabular">{formatDate(s.created_at)}</p>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted">No visits recorded for this vehicle.</p>
          )}
          {services.length > 0 && (
            <p className="mt-6 rounded-2xl bg-well px-5 py-4 text-[13.5px]">
              {services.length} {services.length === 1 ? "visit" : "visits"} on record since{" "}
              {formatDate(services[services.length - 1].created_at)}.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
