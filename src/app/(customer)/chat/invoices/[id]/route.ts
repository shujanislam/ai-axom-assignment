import type { NextRequest } from "next/server";
import { getCurrentCustomer } from "@/lib/auth/accounts";
import { invoicePdfResponse } from "@/lib/invoices/pdf-response";

/** The signed-in customer's own invoice, linked from the invoice message in their chat. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/chat/invoices/[id]">) {
  const customer = await getCurrentCustomer();
  if (!customer) return new Response("Not signed in", { status: 401 });
  return invoicePdfResponse((await ctx.params).id, customer.id);
}
