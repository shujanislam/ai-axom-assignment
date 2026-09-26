import { formatRupees, type Invoice } from "@/lib/invoices/pricing";
import { escape, getTransporter, recipient } from "./transport";

export type InvoiceEmail = {
  to: string;
  name: string;
  plate: string;
  vehicleType: string | null;
  service: string;
  invoice: Invoice;
};

/** Sends the invoice for a completed service. */
export async function sendInvoiceEmail(mail: InvoiceEmail) {
  const { invoice } = mail;
  const vehicle = mail.vehicleType ? `${mail.vehicleType} ${mail.plate}` : mail.plate;
  const date = invoice.date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const gstLabel = `GST (${Math.round(invoice.gst_rate * 100)}%)`;

  const text = [
    `Hi ${mail.name},`,
    "",
    `Your ${vehicle} is ready. ${mail.service} is complete.`,
    "",
    `Invoice ${invoice.number} · ${date}`,
    ...invoice.lines.map(
      (l) => `  ${l.description}  ${l.qty} × ${formatRupees(l.unitPrice)}  ${formatRupees(l.amount)}`,
    ),
    `  Subtotal  ${formatRupees(invoice.subtotal)}`,
    `  ${gstLabel}  ${formatRupees(invoice.gst)}`,
    `  Total  ${formatRupees(invoice.total)}`,
    "",
    "Thank you for servicing with us.",
    "gear-ai",
  ].join("\n");

  const cell = "padding:8px 0;border-bottom:1px solid #e9e7e2";
  const rows = invoice.lines
    .map(
      (l) => `<tr>
        <td style="${cell}">${escape(l.description)}</td>
        <td style="${cell};text-align:right;color:#6b665e">${l.qty} × ${formatRupees(l.unitPrice)}</td>
        <td style="${cell};text-align:right">${formatRupees(l.amount)}</td>
      </tr>`,
    )
    .join("");

  const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f1c18">
  <p style="margin:0 0 16px">Hi ${escape(mail.name)},</p>
  <p style="margin:0 0 24px">Your <strong>${escape(vehicle)}</strong> is ready.
    <strong>${escape(mail.service)}</strong> is complete.</p>
  <p style="margin:0;font-size:13px;color:#6b665e">Invoice</p>
  <p style="margin:2px 0 16px;font-weight:600">${invoice.number} · ${date}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${rows}
    <tr><td style="padding:8px 0;color:#6b665e" colspan="2">Subtotal</td>
      <td style="padding:8px 0;text-align:right">${formatRupees(invoice.subtotal)}</td></tr>
    <tr><td style="padding:0 0 8px;color:#6b665e" colspan="2">${gstLabel}</td>
      <td style="padding:0 0 8px;text-align:right">${formatRupees(invoice.gst)}</td></tr>
    <tr><td style="padding:10px 0;border-top:2px solid #1f1c18;font-weight:600" colspan="2">Total</td>
      <td style="padding:10px 0;border-top:2px solid #1f1c18;text-align:right;font-weight:600">${formatRupees(invoice.total)}</td></tr>
  </table>
  <p style="margin:24px 0 0">Thank you for servicing with us.<br>gear-ai</p>
</div>`;

  await getTransporter().sendMail({
    from: `"gear-ai" <${process.env.GMAIL_USER}>`,
    to: recipient(mail.to),
    subject: `Invoice ${invoice.number} · ${mail.service} for ${mail.plate}`,
    text,
    html,
  });
}
