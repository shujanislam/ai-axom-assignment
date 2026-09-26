"use server";

import { refresh } from "next/cache";
import { after } from "next/server";
import { getCurrentCustomer } from "@/lib/server/auth";
import {
  answerQuestion,
  bookFromMessage,
  postCustomerMessage,
  respondToCustomer,
  skipBooking,
  skipTriage,
  type BookResult,
} from "@/lib/server/chat";
import { isOfferedSlot } from "@/lib/server/slots";

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

/** "Skip booking": closes the slot picker; nothing is booked. */
export async function skipChatBooking(messageId: string): Promise<{ error?: string }> {
  const customer = await requireCustomer();
  if (!UUID.test(messageId) || !(await skipBooking(customer.id, messageId))) {
    refresh();
    return { error: "This booking was already closed." };
  }
  refresh();
  return {};
}
