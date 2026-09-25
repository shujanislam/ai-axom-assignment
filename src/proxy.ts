import { NextResponse, type NextRequest } from "next/server";
import { HOME, readSessionToken, SESSION_COOKIE } from "@/lib/session";

const BOOKING_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isCustomerArea = (path: string) => path === "/chat" || path.startsWith("/chat/");

// Optimistic check only (signature + expiry). Pages and server actions still
// load the advisor or customer from the database before doing anything.
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Customers open /<appointment id> from the service-due email without an account.
  if (BOOKING_PATH.test(path)) return NextResponse.next();

  const session = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  const redirectTo = (to: string) => NextResponse.redirect(new URL(to, request.url));

  if (!session) {
    if (path === "/login") return NextResponse.next();
    const url = new URL("/login", request.url);
    const next = path + request.nextUrl.search;
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  if (path === "/login") return redirectTo(HOME[session.kind]);
  // Lets a stale cookie of either kind be cleared.
  if (path === "/session-expired") return NextResponse.next();
  // Each kind of user stays in its own area.
  if (session.kind === "customer" && !isCustomerArea(path)) return redirectTo(HOME.customer);
  if (session.kind === "advisor" && isCustomerArea(path)) return redirectTo(HOME.advisor);
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
