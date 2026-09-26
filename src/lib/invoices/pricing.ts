// STATIC PRICING — only for appointments completed without a job card (older bookings).
// Appointments with a job card are invoiced from the card's estimate (lib/job-cards/plan.ts).

export type InvoiceLine = { description: string; qty: number; unitPrice: number };

/** Stored as invoices.cost (JSONB). */
export type InvoiceCost = {
  currency: "INR";
  lines: (InvoiceLine & { amount: number })[];
  subtotal: number;
  gst_rate: number;
  gst: number;
  total: number;
};

export type Invoice = InvoiceCost & { number: string; date: Date };

const GST_RATE = 0.18;

const PRICE_LIST: { match: RegExp; lines: InvoiceLine[] }[] = [
  {
    match: /periodic/i,
    lines: [
      { description: "Periodic service labour", qty: 1, unitPrice: 1500 },
      { description: "Engine oil (4 L)", qty: 1, unitPrice: 2200 },
      { description: "Oil filter", qty: 1, unitPrice: 350 },
      { description: "Air filter", qty: 1, unitPrice: 450 },
    ],
  },
  {
    match: /\bac\b|air.?con/i,
    lines: [
      { description: "AC service labour", qty: 1, unitPrice: 1800 },
      { description: "Refrigerant gas top-up", qty: 1, unitPrice: 1200 },
      { description: "Cabin filter", qty: 1, unitPrice: 550 },
    ],
  },
  {
    match: /brake/i,
    lines: [
      { description: "Brake inspection", qty: 1, unitPrice: 800 },
      { description: "Brake cleaning and adjustment", qty: 1, unitPrice: 400 },
    ],
  },
  {
    match: /battery/i,
    lines: [{ description: "Battery health check", qty: 1, unitPrice: 600 }],
  },
];

const FALLBACK: InvoiceLine[] = [{ description: "Service charge", qty: 1, unitPrice: 1000 }];

export function buildInvoiceCost(appointmentType: string): InvoiceCost {
  const items = PRICE_LIST.find((p) => p.match.test(appointmentType))?.lines ?? [
    { ...FALLBACK[0], description: `${appointmentType} (service charge)` },
  ];
  return costFromLines(items);
}

/** Totals with GST for a list of line items. */
export function costFromLines(items: InvoiceLine[]): InvoiceCost {
  const lines = items.map((l) => ({ ...l, amount: l.qty * l.unitPrice }));
  const subtotal = lines.reduce((n, l) => n + l.amount, 0);
  const gst = Math.round(subtotal * GST_RATE);
  return { currency: "INR", lines, subtotal, gst_rate: GST_RATE, gst, total: subtotal + gst };
}

/** Human-facing invoice number, derived from the invoice row's id. */
export function invoiceNumber(invoiceId: string) {
  return `INV-${invoiceId.slice(0, 8).toUpperCase()}`;
}

export function formatRupees(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount,
  );
}
