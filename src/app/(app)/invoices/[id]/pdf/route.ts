import type { NextRequest } from "next/server";
import { getCurrentAdvisor } from "@/lib/auth/accounts";
import { invoicePdfResponse } from "@/lib/invoices/pdf-response";

/** Any invoice, for workshop staff. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/invoices/[id]/pdf">) {
  if (!(await getCurrentAdvisor())) return new Response("Not signed in", { status: 401 });
  return invoicePdfResponse((await ctx.params).id);
}
