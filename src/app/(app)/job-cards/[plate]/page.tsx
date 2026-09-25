import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarIcon, ChatIcon, CheckIcon, ListIcon, SparkIcon } from "@/components/icons";
import { ButtonLink, Card, PageHeader, Row, SectionLabel } from "@/components/ui";
import { actionLabel, formatDate, formatDateTime, humanize, onJobCard } from "@/lib/format";
import { getComplaints, getRecommendations, getServiceHistory, getVehicle } from "@/lib/server/queries";
import { JobCardActions } from "./job-card-actions";

export async function generateMetadata({ params }: PageProps<"/job-cards/[plate]">): Promise<Metadata> {
  const { plate } = await params;
  return { title: `JC-${decodeURIComponent(plate)} · Servicedesk` };
}

const statusStyle: Record<string, string> = {
  APPROVED: "bg-leaf-soft text-[#4a7a2a]",
  SCHEDULE_SERVICE: "bg-leaf-soft text-[#4a7a2a]",
  COMPLETED: "bg-leaf-soft text-[#4a7a2a]",
  REJECTED: "bg-well text-muted",
  CONTACT_CUSTOMER: "bg-amber-soft text-amber-ink",
  NO_ACTION: "bg-well text-muted",
};

export default async function JobCardPage({ params }: PageProps<"/job-cards/[plate]">) {
  const plate = decodeURIComponent((await params).plate);
  const vehicle = await getVehicle(plate);
  if (!vehicle) notFound();

  const [recommendations, complaints, services] = await Promise.all([
    getRecommendations(vehicle.id),
    getComplaints(vehicle.id),
    getServiceHistory(vehicle.id),
  ]);

  const scope = recommendations.filter((r) => onJobCard.includes(r.advisor_action));
  const reviewed = recommendations.filter((r) => r.advisor_action !== "PENDING");
  const pending = recommendations.length - reviewed.length;
  const toSend = recommendations.filter((r) => r.advisor_action === "APPROVED").length;
  const approvers = [...new Set(scope.map((r) => r.advisor_name).filter(Boolean))];
  const count = (action: string) => reviewed.filter((r) => r.advisor_action === action).length;

  const subtitle = [
    vehicle.vehicle_number,
    vehicle.vehicle_type,
    vehicle.customer_name,
    approvers.length ? `approved by ${approvers.join(", ")}` : "nothing approved yet",
  ]
    .filter(Boolean)
    .join(" · ");

  const provenance = [
    vehicle.appointment_at && {
      icon: CalendarIcon,
      title: `${vehicle.appointment_type} booked`,
      note: formatDateTime(vehicle.appointment_at),
    },
    { icon: ListIcon, title: `${services.length} past visits read`, note: "From the service history" },
    {
      icon: ChatIcon,
      title: `${complaints.length} ${complaints.length === 1 ? "complaint" : "complaints"} logged`,
      note: complaints.length ? complaints.map((c) => humanize(c.complaint_type)).join(", ") : "None on record",
    },
    { icon: SparkIcon, title: `${recommendations.length} suggestions raised`, note: `${pending} still to review` },
    {
      icon: CheckIcon,
      title: "Advisor review",
      note: `${count("APPROVED") + count("SCHEDULE_SERVICE") + count("COMPLETED")} accepted, ${count("REJECTED")} ignored`,
    },
  ].filter(Boolean) as { icon: typeof ListIcon; title: string; note: string }[];

  return (
    <>
      <PageHeader
        title={`JC-${vehicle.vehicle_number}`}
        subtitle={subtitle}
        actions={<JobCardActions plate={vehicle.vehicle_number} toSend={toSend} />}
      />

      <div className="mt-6 grid gap-3.5 xl:grid-cols-[1fr_386px]">
        <Card className="flex flex-col p-6">
          <SectionLabel>Customer complaints, as logged</SectionLabel>
          {complaints.length ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {complaints.map((c) => (
                <li key={c.id} className="rounded-2xl bg-well px-5 py-3 text-[14px]">
                  {humanize(c.complaint_type)}
                  <span className="ml-2 text-[12px] text-muted">{formatDate(c.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-2xl bg-well px-5 py-4 text-[14px] text-muted">No complaints logged.</p>
          )}

          <div className="mt-6">
            <SectionLabel count={scope.length}>Approved inspection scope</SectionLabel>
          </div>
          {scope.length ? (
            <ol className="mt-3">
              {scope.map((item) => (
                <li key={item.id} className="flex gap-4 border-b border-line py-4">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-leaf-soft text-leaf">
                    <CheckIcon size={11} strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[14.5px] font-semibold">{item.title}</h3>
                    {item.description && (
                      <p className="mt-1 text-[13.5px] leading-[1.6] text-muted">{item.description}</p>
                    )}
                    <p className="mt-1.5 text-[13px] text-amber-ink">
                      {humanize(item.recommendation_type)} · {humanize(item.priority)} priority ·{" "}
                      {actionLabel[item.advisor_action]}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-3 flex flex-col items-start gap-3 rounded-2xl bg-well px-5 py-5 text-[13.5px] text-muted">
              Nothing has been accepted for this vehicle yet.
              <ButtonLink href={`/job-cards/${vehicle.vehicle_number}/review`} variant="outline">
                Review suggestions
              </ButtonLink>
            </div>
          )}

          <div className="mt-auto pt-8">
            <div className="flex flex-col gap-4 rounded-2xl bg-ink px-6 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[14.5px] font-medium">Nothing on this card is a diagnosis.</p>
                <p className="mt-1 text-[13.5px] leading-[1.5] text-white/55">
                  Every line is an inspection instruction. Faults are confirmed by the technician and priced only after
                  the customer approves the estimate.
                </p>
              </div>
              <div className="shrink-0 sm:text-right">
                <p className="text-[12px] text-white/55">On this card</p>
                <p className="text-[15px] font-medium tabular">
                  {scope.length} {scope.length === 1 ? "line" : "lines"}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-3.5">
          <Card className="p-6">
            <SectionLabel>What the advisor changed</SectionLabel>
            {reviewed.length ? (
              <ul className="mt-4 space-y-4">
                {reviewed.map((r) => (
                  <li key={r.id}>
                    <p className="flex items-center gap-2.5">
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[12px] ${statusStyle[r.advisor_action] ?? "bg-well text-muted"}`}>
                        {actionLabel[r.advisor_action]}
                      </span>
                      <span className="truncate text-[14px] font-medium">{r.title}</span>
                    </p>
                    <p className="mt-1.5 text-[12.5px] leading-[1.6] text-muted">
                      {r.advisor_name ? `By ${r.advisor_name}` : "Reviewer not recorded"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-[13px] text-muted">No suggestions reviewed yet.</p>
            )}
          </Card>

          <Card className="p-6">
            <SectionLabel>Where this card came from</SectionLabel>
            <ol className="mt-4 space-y-4">
              {provenance.map((p) => (
                <li key={p.title} className="flex items-center gap-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-well text-ink">
                    <p.icon size={14} />
                  </span>
                  <span className="leading-tight">
                    <span className="block text-[14px] font-medium">{p.title}</span>
                    <span className="block text-[12px] text-muted">{p.note}</span>
                  </span>
                </li>
              ))}
            </ol>
            <dl className="mt-5 border-t border-line pt-3">
              <Row label="Next step" value="Technician measures and reports" />
              <Row label="Then" value="Estimate to the customer" />
              <Row label="Nothing priced" value="Until the customer approves" />
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
