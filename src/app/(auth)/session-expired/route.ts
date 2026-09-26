import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

// The cookie's signature is valid but its advisor is gone (deleted, or the database was reset).
// The proxy would keep treating it as signed in and bounce /login back to the app, so drop it here.
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
