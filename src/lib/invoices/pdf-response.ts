import "server-only";
import { getInvoice } from "./queries";
import { invoiceFileName, renderInvoicePdf } from "./pdf";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The invoice as a PDF download, or 404. With `customerId`, only that customer's invoices are
 * served; the same 404 either way, so ids of other customers' invoices can't be probed.
 */
export async function invoicePdfResponse(id: string, customerId?: string) {
  const invoice = UUID.test(id) ? await getInvoice(id) : null;
  if (!invoice || (customerId && invoice.customer_id !== customerId)) {
    return new Response("Invoice not found", { status: 404 });
  }
  const pdf = await renderInvoicePdf(invoice);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoiceFileName(invoice.id)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
