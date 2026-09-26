import "server-only";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { invoiceNumber } from "./pricing";
import type { InvoiceRow } from "./queries";

// A4 invoice drawn with the PDF standard fonts, so nothing has to be bundled or fetched.
// Those fonts only cover Latin-1 (WinAnsi): no ₹ sign, hence "Rs.", and other characters
// (a name in Assamese, say) print as "?".

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.12, 0.11, 0.09);
const MUTED = rgb(0.42, 0.4, 0.37);
const LINE = rgb(0.91, 0.9, 0.87);

/** Keeps what WinAnsi can encode: printable Latin-1 plus the typographic marks it adds. */
const safe = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff·×–—‘’“”…•€]/g, "?");

const rupees = (amount: number) =>
  `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount)}`;

export function invoiceFileName(invoiceId: string) {
  return `${invoiceNumber(invoiceId)}.pdf`;
}

export async function renderInvoicePdf(invoice: InvoiceRow) {
  const doc = await PDFDocument.create();
  const number = invoiceNumber(invoice.id);
  doc.setTitle(`Invoice ${number}`);
  doc.setAuthor("gear-ai");
  doc.setCreationDate(new Date(invoice.created_at));

  const page = doc.addPage(A4);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [width, height] = A4;
  const right = width - MARGIN;

  const text = (
    value: string,
    x: number,
    y: number,
    { font = regular, size = 10, color = INK, align = "left", maxWidth }: TextOptions = {},
  ) => {
    const line = fit(safe(value), font, size, maxWidth);
    const at = align === "right" ? x - font.widthOfTextAtSize(line, size) : x;
    page.drawText(line, { x: at, y, font, size, color });
  };

  // Header
  let y = height - MARGIN - 8;
  text("gear-ai", MARGIN, y, { font: bold, size: 20 });
  text("INVOICE", right, y, { font: bold, size: 20, align: "right" });
  y -= 22;
  text("Car service workshop", MARGIN, y, { color: MUTED });
  text(number, right, y, { color: MUTED, align: "right" });
  y -= 14;
  text(dateOf(invoice.created_at), right, y, { color: MUTED, align: "right" });

  // Billed to / vehicle
  y -= 40;
  const col2 = MARGIN + (right - MARGIN) / 2;
  text("BILLED TO", MARGIN, y, { font: bold, size: 8, color: MUTED });
  text("VEHICLE", col2, y, { font: bold, size: 8, color: MUTED });
  y -= 16;
  text(invoice.customer_name, MARGIN, y, { font: bold, size: 11, maxWidth: col2 - MARGIN - 12 });
  text(invoice.vehicle_number, col2, y, { font: bold, size: 11 });
  y -= 15;
  text(invoice.phone_number, MARGIN, y, { color: MUTED });
  if (invoice.vehicle_type) text(invoice.vehicle_type, col2, y, { color: MUTED });
  y -= 15;
  if (invoice.email) text(invoice.email, MARGIN, y, { color: MUTED, maxWidth: col2 - MARGIN - 12 });
  text(invoice.appointment_type, col2, y, { color: MUTED, maxWidth: right - col2 });

  // Line items
  y -= 44;
  const qtyX = right - 190;
  const rateX = right - 100;
  text("Item", MARGIN, y, { size: 9, color: MUTED });
  text("Qty", qtyX, y, { size: 9, color: MUTED, align: "right" });
  text("Rate", rateX, y, { size: 9, color: MUTED, align: "right" });
  text("Amount", right, y, { size: 9, color: MUTED, align: "right" });
  y -= 10;
  rule(page, y);

  const { cost } = invoice;
  for (const line of cost.lines) {
    y -= 20;
    text(line.description, MARGIN, y, { maxWidth: qtyX - MARGIN - 40 });
    text(String(line.qty), qtyX, y, { color: MUTED, align: "right" });
    text(rupees(line.unitPrice), rateX, y, { color: MUTED, align: "right" });
    text(rupees(line.amount), right, y, { align: "right" });
    y -= 10;
    rule(page, y);
  }

  // Totals
  const labelX = right - 200;
  y -= 22;
  text("Subtotal", labelX, y, { color: MUTED });
  text(rupees(cost.subtotal), right, y, { align: "right" });
  y -= 18;
  text(`GST (${Math.round(cost.gst_rate * 100)}%)`, labelX, y, { color: MUTED });
  text(rupees(cost.gst), right, y, { align: "right" });
  y -= 12;
  page.drawLine({ start: { x: labelX, y }, end: { x: right, y }, thickness: 1.5, color: INK });
  y -= 20;
  text("Total", labelX, y, { font: bold, size: 12 });
  text(rupees(cost.total), right, y, { font: bold, size: 12, align: "right" });

  // Footer
  text("Thank you for servicing with us.", MARGIN, MARGIN + 14, { color: MUTED });
  text(`Invoice ${number} for appointment ${invoice.appointment_id.slice(0, 8)}`, MARGIN, MARGIN, {
    size: 8,
    color: MUTED,
  });

  return doc.save();
}

type TextOptions = {
  font?: PDFFont;
  size?: number;
  color?: ReturnType<typeof rgb>;
  align?: "left" | "right";
  maxWidth?: number;
};

/** Cuts text to `maxWidth` with an ellipsis. */
function fit(value: string, font: PDFFont, size: number, maxWidth?: number) {
  if (!maxWidth || font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let cut = value;
  while (cut && font.widthOfTextAtSize(`${cut}…`, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function rule(page: PDFPage, y: number) {
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 0.75, color: LINE });
}

function dateOf(value: Date | string) {
  return new Date(value).toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
