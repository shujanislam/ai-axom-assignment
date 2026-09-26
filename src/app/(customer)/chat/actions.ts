"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/accounts";
import {
  answerQuestion,
  bookFromMessage,
  postAssistantMessage,
  postCustomerMessage,
  SKIP_BOOKING_REPLY,
  skipBooking,
  skipTriage,
  type BookResult,
} from "@/lib/chat/messages";
import { respondToCustomer } from "@/lib/chat/assistant";
import { FEEDBACK_COMMENT_MAX } from "@/lib/chat/constants";
import { reviewFeedback } from "@/lib/feedback/ai-review";
import { saveFeedback } from "@/lib/feedback/save";
import { recordSkip } from "@/lib/retention/detect";
import { notifyOwners } from "@/lib/retention/owner";
import { answerReason, reachOut } from "@/lib/retention/outreach";
import { isOfferedSlot } from "@/lib/booking/slots";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireCustomer() {
  const customer = await getCurrentCustomer();
  if (!customer) throw new Error("Not signed in");
  return customer;
}

/** Saves the message straight away; the assistant replies after the response is sent. */
export async function sendMessage(body: string): Promise<{ error?: string }> {
  const customer = await requireCustomer();
  const text = body.trim();
  if (!text) return { error: "Write a message first." };
  if (text.length > 4000) return { error: "That message is too long." };

  await postCustomerMessage(customer.id, text);
  after(() => respondToCustomer(customer.id));
  refresh();
  return {};
}

export async function bookFromChat(messageId: string, slotIso: string): Promise<BookResult> {
  const customer = await requireCustomer();
  const slot = new Date(slotIso);
  if (!UUID.test(messageId) || Number.isNaN(+slot) || !isOfferedSlot(slot)) {
    return { error: "That time is not available. Pick another slot." };
  }
  const result = await bookFromMessage(customer.id, messageId, slot);
  refresh();
  return result;
}

/** Tapping an option answers the triage question; the assistant then asks the next one or decides. */
export async function answerChatQuestion(messageId: string, option: string): Promise<{ error?: string }> {
  const customer = await requireCustomer();
  if (!UUID.test(messageId)) return { error: "Invalid question." };
  if (!(await answerQuestion(customer.id, messageId, option))) {
    refresh();
    return { error: "This question was already answered." };
  }
  after(() => respondToCustomer(customer.id));
  refresh();
  return {};
}

/** "Skip the questions": the problem goes to an advisor without the rest of the triage. */
export async function skipChatQuestions(messageId: string): Promise<{ error?: string }> {
  const customer = await requireCustomer();
  if (!UUID.test(messageId) || !(await skipTriage(customer.id, messageId))) {
    refresh();
    return { error: "These questions can’t be skipped any more." };
  }
  refresh();
  return {};
}

/**
 * "Skip booking": closes the slot picker; nothing is booked. The skip is recorded as a lapse and
 * the reply asks what's holding them back; the owner hears about it with the next scheduled run.
 */
export async function skipChatBooking(messageId: string): Promise<{ error?: string }> {
  const customer = await requireCustomer();
  if (!UUID.test(messageId) || !(await skipBooking(customer.id, messageId))) {
    refresh();
    return { error: "This booking was already closed." };
  }
  const lapseId = await recordSkip(customer.id, messageId);
  if (!lapseId || (await reachOut([lapseId])) === 0) await postAssistantMessage(customer.id, SKIP_BOOKING_REPLY);
  refresh();
  return {};
}

/** Tapping a reason on "what got in the way?": saved, and answered with what fits it. */
export async function answerChatReason(messageId: string, label: string): Promise<{ error?: string }> {
  const customer = await requireCustomer();
  const answered = UUID.test(messageId) ? await answerReason(customer.id, messageId, label) : null;
  refresh();
  if (!answered) return { error: "This question was already answered." };
  // An unhappy customer shouldn't wait for the next scheduled run.
  if (answered.reason === "UNHAPPY") after(() => notifyOwners(answered.lapseId));
  return {};
}

/** Rates a finished visit from its FEEDBACK message; the model reads the comment afterwards. */
export async function rateVisit(messageId: string, rating: number, comment: string): Promise<{ error?: string }> {
  const customer = await requireCustomer();
  const text = comment.trim();
  if (!UUID.test(messageId) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Pick 1 to 5 stars." };
  }
  if (text.length > FEEDBACK_COMMENT_MAX) return { error: "That comment is too long." };

  const feedbackId = await saveFeedback(customer.id, messageId, rating, text || null);
  if (!feedbackId) {
    refresh();
    return { error: "This visit was already rated." };
  }
  after(() => reviewFeedback(feedbackId));
  refresh();
  return {};
}
