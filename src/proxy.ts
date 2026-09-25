import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "@/lib/session";

const BOOKING_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Optimistic check only (signature + expiry). Pages and server actions still
// load the advisor from the database before doing anything.
export function proxy(request: NextRequest) {
  // Customers open /<appointment id> from the service-due email without an account.
  if (BOOKING_PATH.test(request.nextUrl.pathname)) return NextResponse.next();

  const signedIn = readSessionToken(request.cookies.get(SESSION_COOKIE)?.value) !== null;
  const onLogin = request.nextUrl.pathname === "/login";

  if (!signedIn && !onLogin) {
    const url = new URL("/login", request.url);
    const next = request.nextUrl.pathname + request.nextUrl.search;
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  if (signedIn && onLogin) {
    return NextResponse.redirect(new URL("/service-due", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
