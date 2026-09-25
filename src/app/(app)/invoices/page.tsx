import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatRupees, invoiceNumber } from "@/lib/invoice";
import { getInvoices } from "@/lib/server/queries";

export const metadata: Metadata = { title: "Invoices · Servicedesk" };

export default async function InvoicesPage() {
  const invoices = await getInvoices();
  const billed = invoices.reduce((n, i) => n + i.cost.total, 0);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={`${invoices.length} issued · ${formatRupees(billed)} billed in total, newest first`}
      />

      <Card className="mt-6 overflow-x-auto px-6 pb-4 pt-4">
        <table className="w-full min-w-[720px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-line text-[12.5px] text-muted">
              <th className="px-1 py-4 font-normal">Invoice</th>
              <th className="px-1 py-4 font-normal">Vehicle</th>
              <th className="px-1 py-4 font-normal">Customer</th>
              <th className="px-1 py-4 font-normal">Service</th>
              <th className="px-1 py-4 font-normal">Issued</th>
              <th className="px-1 py-4 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="border-b border-line last:border-0">
                <td className="px-1 py-[17px]">
                  <Link href={`/invoices/${i.id}`} className="font-semibold tabular hover:underline">
                    {invoiceNumber(i.id)}
                  </Link>
                </td>
                <td className="px-1 py-[17px]">{i.vehicle_number}</td>
                <td className="px-1 py-[17px] text-muted">{i.customer_name}</td>
                <td className="px-1 py-[17px]">{i.appointment_type}</td>
                <td className="px-1 py-[17px] text-muted tabular">{formatDateTime(i.created_at)}</td>
                <td className="px-1 py-[17px] text-right font-medium tabular">{formatRupees(i.cost.total)}</td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted">
                  No invoices yet. Completing an appointment issues one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
