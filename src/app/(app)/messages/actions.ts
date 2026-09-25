"use server";

import { refresh } from "next/cache";
import { getCurrentAdvisor } from "@/lib/server/auth";
import { postAdvisorMessage } from "@/lib/server/chat";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function replyToCustomer(customerId: string, body: string): Promise<{ error?: string }> {
  const advisor = await getCurrentAdvisor();
  if (!advisor) throw new Error("Not signed in");
  const text = body.trim();
  if (!UUID.test(customerId)) return { error: "Invalid conversation." };
  if (!text) return { error: "Write a message first." };
  if (text.length > 4000) return { error: "That message is too long." };

  await postAdvisorMessage(customerId, advisor.id, text);
  refresh();
  return {};
}
