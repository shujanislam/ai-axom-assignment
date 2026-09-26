import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ButtonLink, Card, PageHeader, Row, SectionLabel } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatRupees, invoiceNumber } from "@/lib/invoices/pricing";
import { getInvoice } from "@/lib/invoices/queries";

export const metadata: Metadata = { title: "Invoice · gear-ai" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const { cost } = invoice;
  const vehicle = invoice.vehicle_type ? `${invoice.vehicle_type} ${invoice.vehicle_number}` : invoice.vehicle_number;

  return (
    <>
      <PageHeader
        title={invoiceNumber(invoice.id)}
        subtitle={`${invoice.appointment_type} · ${invoice.customer_name} · issued ${formatDateTime(invoice.created_at)}`}
        actions={
          <ButtonLink variant="secondary" href="/invoices">
            All invoices
          </ButtonLink>
        }
      />

      <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card className="overflow-x-auto px-6 pb-5 pt-4">
          <table className="w-full min-w-[480px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line text-[12.5px] text-muted">
                <th className="px-1 py-4 font-normal">Item</th>
                <th className="w-[12%] px-1 py-4 text-right font-normal">Qty</th>
                <th className="w-[18%] px-1 py-4 text-right font-normal">Rate</th>
                <th className="w-[18%] px-1 py-4 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {cost.lines.map((l) => (
                <tr key={l.description} className="border-b border-line">
                  <td className="px-1 py-[15px]">{l.description}</td>
                  <td className="px-1 py-[15px] text-right text-muted tabular">{l.qty}</td>
                  <td className="px-1 py-[15px] text-right text-muted tabular">{formatRupees(l.unitPrice)}</td>
                  <td className="px-1 py-[15px] text-right tabular">{formatRupees(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto mt-3 max-w-[280px] px-1">
            <Row label="Subtotal" value={formatRupees(cost.subtotal)} dense />
            <Row label={`GST (${Math.round(cost.gst_rate * 100)}%)`} value={formatRupees(cost.gst)} dense />
            <div className="mt-2 flex items-baseline justify-between gap-6 border-t border-ink pt-3">
              <dt className="text-[14px] font-semibold">Total</dt>
              <dd className="text-[20px] font-semibold tracking-[-0.02em] tabular">{formatRupees(cost.total)}</dd>
            </div>
          </dl>
        </Card>

        <div className="space-y-3.5">
          <SectionLabel>Billed to</SectionLabel>
          <Card className="px-6 py-4">
            <dl>
              <Row label="Customer" value={invoice.customer_name} />
              <Row label="Email" value={invoice.email ?? "Not on file"} />
              <Row label="Phone" value={invoice.phone_number} />
              <Row label="Vehicle" value={vehicle} />
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
