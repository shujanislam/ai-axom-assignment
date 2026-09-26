import { escape, getTransporter, recipient } from "./transport";

export type ServiceDueEmail = {
  to: string;
  name: string;
  plate: string;
  vehicleType: string | null;
  service: string;
  description: string | null;
  link: string;
};

/** Tells a customer their vehicle is due and links to the slot picker. */
export async function sendServiceDueEmail(mail: ServiceDueEmail) {
  const vehicle = mail.vehicleType ? `${mail.vehicleType} ${mail.plate}` : mail.plate;
  const subject = `${mail.service} due for ${mail.plate}`;

  const text = [
    `Hi ${mail.name},`,
    "",
    `Your ${vehicle} is due for: ${mail.service}.`,
    ...(mail.description ? ["", mail.description] : []),
    "",
    `Pick a time that suits you: ${mail.link}`,
    "",
    "gear-ai",
  ].join("\n");

  const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f1c18">
  <p style="margin:0 0 16px">Hi ${escape(mail.name)},</p>
  <p style="margin:0 0 16px">Your <strong>${escape(vehicle)}</strong> is due for
    <strong>${escape(mail.service)}</strong>.</p>
  ${mail.description ? `<p style="margin:0 0 16px;color:#6b665e">${escape(mail.description)}</p>` : ""}
  <p style="margin:24px 0">
    <a href="${escape(mail.link)}"
       style="background:#1f1c18;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;display:inline-block">
      Choose a slot
    </a>
  </p>
  <p style="margin:0;color:#6b665e;font-size:13px">Or open this link: ${escape(mail.link)}</p>
  <p style="margin:24px 0 0">gear-ai</p>
</div>`;

  await getTransporter().sendMail({
    from: `"gear-ai" <${process.env.GMAIL_USER}>`,
    to: recipient(mail.to),
    subject,
    text,
    html,
  });
}
