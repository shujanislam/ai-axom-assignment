import { escape, getTransporter, recipient } from "./transport";

export type RetentionEmail = {
  to: string;
  name: string;
  subject: string;
  /** One or two plain sentences; the same words as the chat message. */
  lines: string[];
  /** The booking link, when there is something the customer can still book. */
  link: string | null;
};

/** A gentle nudge for a customer who missed a slot, didn't book, or let a service date pass. */
export async function sendRetentionEmail(mail: RetentionEmail) {
  const text = [
    `Hi ${mail.name},`,
    "",
    ...mail.lines,
    "",
    mail.link ? `Pick a new time: ${mail.link}` : "Just reply in your gear-ai chat, or call the workshop.",
    "",
    "gear-ai",
  ].join("\n");

  const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f1c18">
  <p style="margin:0 0 16px">Hi ${escape(mail.name)},</p>
  ${mail.lines.map((l) => `<p style="margin:0 0 16px">${escape(l)}</p>`).join("")}
  ${
    mail.link
      ? `<p style="margin:24px 0">
    <a href="${escape(mail.link)}"
       style="background:#1f1c18;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;display:inline-block">
      Pick a new time
    </a>
  </p>
  <p style="margin:0;color:#6b665e;font-size:13px">Or open this link: ${escape(mail.link)}</p>`
      : `<p style="margin:0;color:#6b665e">Just reply in your gear-ai chat, or call the workshop.</p>`
  }
  <p style="margin:24px 0 0">gear-ai</p>
</div>`;

  await getTransporter().sendMail({
    from: `"gear-ai" <${process.env.GMAIL_USER}>`,
    to: recipient(mail.to),
    subject: mail.subject,
    text,
    html,
  });
}
