import { NextResponse } from "next/server";

import {
  buildGoogleOAuthUrl,
  createGoogleOAuthState,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_RETURN_COOKIE,
} from "@/lib/google-oauth";

export const runtime = "nodejs";

const COOKIE_SECURE =
  process.env.AUTH_COOKIE_SECURE !== undefined
    ? process.env.AUTH_COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";

const oauthCookieDomain = (request: Request) => {
  const hostname = new URL(request.url).hostname;
  return hostname === "discoverkeywords.co" || hostname.endsWith(".discoverkeywords.co")
    ? ".discoverkeywords.co"
    : undefined;
};

export async function GET(request: Request) {
  try {
    const state = createGoogleOAuthState();
    const response = NextResponse.redirect(buildGoogleOAuthUrl(state));
    const requestUrl = new URL(request.url);
    const nextPath = requestUrl.searchParams.get("next") || "/dashboard/expand";
    const checkout = requestUrl.searchParams.get("checkout") || "";
    const returnTo = new URL(nextPath.startsWith("/") ? nextPath : "/dashboard/expand", request.url);
    if (checkout) returnTo.searchParams.set("checkout", checkout);
    response.cookies.set({
      name: GOOGLE_OAUTH_STATE_COOKIE,
      value: state,
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      path: "/",
      maxAge: 10 * 60,
      domain: oauthCookieDomain(request),
    });
    response.cookies.set({
      name: GOOGLE_OAUTH_RETURN_COOKIE,
      value: `${returnTo.pathname}${returnTo.search}`,
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      path: "/",
      maxAge: 10 * 60,
      domain: oauthCookieDomain(request),
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google OAuth is not available";
    const url = new URL("/login", request.url);
    url.searchParams.set("error", message);
    return NextResponse.redirect(url);
  }
}
