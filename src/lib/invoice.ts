// STATIC PRICING — placeholder until real job-card billing exists.
// Every appointment type maps to a fixed list of line items; anything unknown gets a flat charge.

export type InvoiceLine = { description: string; qty: number; unitPrice: number };

export type Invoice = {
  number: string;
  date: Date;
  lines: (InvoiceLine & { amount: number })[];
  subtotal: number;
  gstRate: number;
  gst: number;
  total: number;
};

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

export function buildInvoice(appointmentId: string, appointmentType: string, date: Date): Invoice {
  const items = PRICE_LIST.find((p) => p.match.test(appointmentType))?.lines ?? [
    { ...FALLBACK[0], description: `${appointmentType} (service charge)` },
  ];
  const lines = items.map((l) => ({ ...l, amount: l.qty * l.unitPrice }));
  const subtotal = lines.reduce((n, l) => n + l.amount, 0);
  const gst = Math.round(subtotal * GST_RATE);
  return {
    number: `INV-${appointmentId.slice(0, 8).toUpperCase()}`,
    date,
    lines,
    subtotal,
    gstRate: GST_RATE,
    gst,
    total: subtotal + gst,
  };
}

export function formatRupees(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount,
  );
}
