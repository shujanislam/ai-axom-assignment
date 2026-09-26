import { escape, getTransporter, recipient } from "./transport";

export type OwnerAlertRow = {
  customer: string;
  phone: string;
  plate: string | null;
  service: string;
  what: string;
  /** The customer's answer to "what got in the way?", if they gave one. */
  reason: string | null;
};

/** Tells the workshop owner which customers are slipping away, and why when we know. */
export async function sendOwnerAlertEmail(to: string, rows: OwnerAlertRow[], urgent: boolean) {
  const subject = urgent
    ? `Unhappy customer: ${rows[0].customer} needs a call`
    : `${rows.length} ${rows.length === 1 ? "customer" : "customers"} slipping away`;
  const line = (r: OwnerAlertRow) =>
    `${r.customer} (${r.phone})${r.plate ? `, ${r.plate}` : ""}: ${r.what}, ${r.service}` +
    (r.reason ? `. Said: ${r.reason}` : "");

  const text = [
    urgent ? "A customer told us they weren’t happy with their last visit:" : "These customers need attention:",
    "",
    ...rows.map((r) => `- ${line(r)}`),
    "",
    "We ask each customer in the chat what got in the way; their answers show on the Today page.",
    "",
    "gear-ai",
  ].join("\n");

  const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f1c18">
  <p style="margin:0 0 16px">${
    urgent ? "A customer told us they weren’t happy with their last visit:" : "These customers need attention:"
  }</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${rows
      .map(
        (r) => `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #ebe9e4;vertical-align:top">
        <strong>${escape(r.customer)}</strong><br>
        <span style="color:#6b665e">${escape(r.phone)}${r.plate ? ` · ${escape(r.plate)}` : ""}</span>
      </td>
      <td style="padding:10px 0 10px 16px;border-bottom:1px solid #ebe9e4;vertical-align:top">
        ${escape(r.what)} · ${escape(r.service)}
        ${r.reason ? `<br><span style="color:#8a5a14">Said: ${escape(r.reason)}</span>` : ""}
      </td>
    </tr>`,
      )
      .join("")}
  </table>
  <p style="margin:20px 0 0;color:#6b665e;font-size:13px">
    We ask each customer in the chat what got in the way; their answers show on the Today page.
  </p>
  <p style="margin:24px 0 0">gear-ai</p>
</div>`;

  await getTransporter().sendMail({
    from: `"gear-ai" <${process.env.GMAIL_USER}>`,
    to: recipient(to),
    subject,
    text,
    html,
  });
}
