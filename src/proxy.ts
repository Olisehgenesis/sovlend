import { getSessionCookie } from "better-auth/cookies";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/investor/request-access" || request.nextUrl.pathname.startsWith("/investor/join/")) {
    return NextResponse.next();
  }
  if (!getSessionCookie(request, { cookiePrefix: "sovlend" })) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/admin/:path*", "/backoffice/:path*", "/clients/:path*", "/investor/:path*", "/loans/:path*", "/settings/:path*"],
};