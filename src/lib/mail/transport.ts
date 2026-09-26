// Gmail transport shared by every email, plus the test-safety redirect.
import nodemailer from "nodemailer";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

export function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must be set to send email.");
  transporter ??= nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  return transporter;
}

/**
 * Where a customer email actually goes. MAIL_REDIRECT_TO sends everything to one inbox;
 * outside production it is required, so testing never mails real customers.
 */
export function recipient(customerEmail: string) {
  const redirect = process.env.MAIL_REDIRECT_TO;
  if (redirect) return redirect;
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Set MAIL_REDIRECT_TO to your own address to send email outside production.");
  }
  return customerEmail;
}

export const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
