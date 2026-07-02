import { NextRequest, NextResponse } from "next/server";

import {
  createPendingOAuthUser,
  createSession,
  findUserByEmail,
  findUserByIdentity,
  linkOAuthIdentity,
  setSessionCookie,
} from "@/lib/auth";
import {
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  GOOGLE_OAUTH_RETURN_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
} from "@/lib/google-oauth";

export const runtime = "nodejs";

const COOKIE_SECURE =
  process.env.AUTH_COOKIE_SECURE !== undefined
    ? process.env.AUTH_COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";

const oauthCookieDomain = (request: NextRequest) => {
  const hostname = request.nextUrl.hostname;
  return hostname === "discoverkeywords.co" || hostname.endsWith(".discoverkeywords.co")
    ? ".discoverkeywords.co"
    : undefined;
};

const loginRedirect = (request: NextRequest, message: string) => {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
};

const dashboardRedirect = (request: NextRequest) => {
  const returnTo = request.cookies.get(GOOGLE_OAUTH_RETURN_COOKIE)?.value || "/dashboard/expand";
  const url = new URL(returnTo.startsWith("/") ? returnTo : "/dashboard/expand", request.url);
  if (url.searchParams.get("checkout") === "founding") {
    url.pathname = "/pricing";
    url.searchParams.set("checkout", "founding");
  }
  return NextResponse.redirect(url);
};

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return loginRedirect(request, "Google sign-in state verification failed");
  }

  try {
    const accessToken = await exchangeGoogleCode(code);
    const profile = await fetchGoogleUserInfo(accessToken);

    if (!profile.email_verified) {
      return loginRedirect(request, "Google email is not verified");
    }

    const existingIdentity = await findUserByIdentity("google", profile.sub);
    const user =
      existingIdentity ||
      (await findUserByEmail(profile.email)) ||
      (await createPendingOAuthUser(profile.email));

    await linkOAuthIdentity({
      userId: user.id,
      provider: "google",
      providerSubject: profile.sub,
      providerEmail: profile.email,
      emailVerified: profile.email_verified,
    });

    const session = await createSession(user.id);
    const response = dashboardRedirect(request);
    response.cookies.set({
      name: GOOGLE_OAUTH_STATE_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      path: "/",
      maxAge: 0,
      domain: oauthCookieDomain(request),
    });
    response.cookies.set({
      name: GOOGLE_OAUTH_RETURN_COOKIE,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: COOKIE_SECURE,
      path: "/",
      maxAge: 0,
      domain: oauthCookieDomain(request),
    });
    return setSessionCookie(response, session.token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google sign-in failed";
    return loginRedirect(request, message);
  }
}
