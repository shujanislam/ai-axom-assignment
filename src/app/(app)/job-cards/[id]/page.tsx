import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckIcon } from "@/components/icons";
import { ButtonLink, Card, Dot, PageHeader, Row, SectionLabel, Tag } from "@/components/ui";
import { formatWindow } from "@/lib/booking/slots";
import { actionLabel, humanize, jobCardNumber, jobCardStatus, onJobCard } from "@/lib/format";
import { formatRupees } from "@/lib/invoices/pricing";
import { getJobCard, getMechanicOptions, getRecommendations } from "@/lib/job-cards/queries";
import { CompleteButton } from "@/app/(app)/appointments/complete-button";
import { MechanicPicker, SendToWorkshopButton, StartJobButton } from "./card-controls";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/job-cards/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `${UUID.test(id) ? jobCardNumber(id) : "Job card"} · gear-ai` };
}

export default async function JobCardPage({ params }: PageProps<"/job-cards/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const card = await getJobCard(id);
  if (!card) notFound();

  const [mechanics, recommendations] = await Promise.all([
    getMechanicOptions(card.id),
    getRecommendations(card.vehicle_id),
  ]);
  const status = jobCardStatus[card.status];
  const open = card.status === "DRAFT" || card.status === "ASSIGNED" || card.status === "IN_PROGRESS";
  const scope = recommendations.filter((r) => onJobCard.includes(r.advisor_action));
  const toSend = recommendations.filter((r) => r.advisor_action === "APPROVED").length;
  const pending = recommendations.filter((r) => r.advisor_action === "PENDING").length;
  const { estimate } = card;

  const subtitle = [
    card.vehicle_number,
    card.vehicle_type,
    card.customer_name,
    formatWindow(card.starts_at, card.ends_at),
  ]
    .filter(Boolean)
    .join(" · ");

  let actions = null;
  if (card.status === "ASSIGNED") actions = <StartJobButton jobCardId={card.id} />;
  else if (card.status === "IN_PROGRESS" || card.invoice_id)
    actions = (
      <CompleteButton appointmentId={card.appointment_id} invoiceId={card.invoice_id} canComplete={open} />
    );

  return (
    <>
      <PageHeader title={jobCardNumber(card.id)} subtitle={subtitle} actions={actions} />

      <div className="mt-6 grid gap-3.5 xl:grid-cols-[1fr_386px]">
        <Card className="flex flex-col p-6">
          <SectionLabel>The job</SectionLabel>
          <h2 className="mt-3 text-[20px] font-semibold tracking-[-0.02em]">{card.title}</h2>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <Tag>{card.skill_label}</Tag>
            <span className="flex items-center gap-2 text-[13px] text-muted">
              <Dot tone={status.tone} />
              {status.label}
            </span>
          </p>
          <dl className="mt-4 border-t border-line pt-3">
            <Row label="In the workshop" value={formatWindow(card.starts_at, card.ends_at)} />
            <Row label="Labour" value={`${card.labour_hours} ${card.labour_hours === 1 ? "hour" : "hours"}`} />
            <Row label="Customer" value={`${card.customer_name} · ${card.customer_phone}`} />
          </dl>

          <div className="mt-6">
            <SectionLabel count={card.parts.length}>Parts</SectionLabel>
          </div>
          {card.parts.length ? (
            <table className="mt-2 w-full text-left text-[14px]">
              <thead>
                <tr className="border-b border-line text-[12.5px] text-muted">
                  <th className="py-3 font-normal">Part</th>
                  <th className="py-3 text-right font-normal">Qty</th>
                  <th className="py-3 text-right font-normal">Price</th>
                  <th className="py-3 pl-4 font-normal">Stock</th>
                </tr>
              </thead>
              <tbody>
                {card.parts.map((p) => (
                  <tr key={p.part_id} className="border-b border-line last:border-0">
                    <td className="py-3">
                      {p.name}
                      <span className="ml-2 text-[12px] text-subtle">{p.sku}</span>
                    </td>
                    <td className="py-3 text-right tabular">{p.qty}</td>
                    <td className="py-3 text-right tabular">{formatRupees(p.qty * p.unit_price)}</td>
                    <td className="py-3 pl-4">
                      {p.in_stock ? (
                        <span className="text-[13px] text-muted">In stock</span>
                      ) : (
                        <Tag className="bg-amber-soft text-amber-ink">To order</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-3 rounded-2xl bg-well px-5 py-4 text-[14px] text-muted">
              No parts expected for this job.
            </p>
          )}

          <div className="mt-auto pt-8">
            <div className="rounded-2xl bg-ink px-6 py-5 text-white">
              <p className="text-[14.5px] font-medium">Estimate</p>
              <dl className="mt-3 space-y-1.5 text-[13.5px]">
                {estimate.lines.map((l) => (
                  <div key={l.description} className="flex justify-between gap-6 text-white/70">
                    <dt>
                      {l.description}
                      {l.qty > 1 && ` × ${l.qty}`}
                    </dt>
                    <dd className="tabular">{formatRupees(l.amount)}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-6 border-t border-white/15 pt-2 text-white/70">
                  <dt>GST {Math.round(estimate.gst_rate * 100)}%</dt>
                  <dd className="tabular">{formatRupees(estimate.gst)}</dd>
                </div>
                <div className="flex justify-between gap-6 text-[15px] font-medium">
                  <dt>Total</dt>
                  <dd className="tabular">{formatRupees(estimate.total)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[12.5px] leading-[1.5] text-white/55">
                Taken when the visit was booked. It becomes the invoice when the job is completed.
              </p>
            </div>
          </div>
        </Card>

        <div className="space-y-3.5">
          <Card className="p-6">
            <SectionLabel>Mechanic</SectionLabel>
            {card.mechanic_name ? (
              <>
                <p className="mt-3 text-[16px] font-semibold">{card.mechanic_name}</p>
                {card.mechanic_phone && <p className="mt-0.5 text-[13px] text-muted">{card.mechanic_phone}</p>}
              </>
            ) : (
              <p className="mt-3 text-[14px] text-amber">
                Nobody with this skill was free at booking time. Pick someone below.
              </p>
            )}
            {open && <MechanicPicker jobCardId={card.id} options={mechanics} />}
          </Card>

          <Card className="p-6">
            <SectionLabel count={scope.length}>Accepted work for this vehicle</SectionLabel>
            {scope.length ? (
              <ul className="mt-3">
                {scope.map((item) => (
                  <li key={item.id} className="flex gap-3 border-b border-line py-3 last:border-0">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-leaf-soft text-leaf">
                      <CheckIcon size={11} strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium">{item.title}</p>
                      <p className="mt-0.5 text-[12.5px] text-muted">
                        {humanize(item.priority)} priority · {actionLabel[item.advisor_action]}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[13px] text-muted">Nothing extra has been accepted for this vehicle.</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {toSend > 0 && <SendToWorkshopButton plate={card.vehicle_number} count={toSend} />}
              <ButtonLink href={`/vehicles/${card.vehicle_number}/review`} variant="outline">
                {pending ? `Review ${pending} suggestions` : "Suggestions"}
              </ButtonLink>
            </div>
          </Card>

          <p className="px-2 text-[12.5px] text-muted">
            <Link href={`/vehicles/${card.vehicle_number}`} className="hover:text-ink hover:underline">
              Vehicle history →
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
