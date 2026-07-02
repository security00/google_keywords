import "server-only";

import { randomBytes } from "crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_OAUTH_STATE_COOKIE = "gk_google_oauth_state";
export const GOOGLE_OAUTH_RETURN_COOKIE = "gk_google_oauth_return";

export type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
};

const proxyUrl = () =>
  process.env.HTTPS_PROXY?.trim() ||
  process.env.https_proxy?.trim() ||
  process.env.HTTP_PROXY?.trim() ||
  process.env.http_proxy?.trim() ||
  "";

const googleFetch = async (input: string, init?: RequestInit) => {
  const proxy = proxyUrl();
  if (!proxy || process.env.NODE_ENV === "production") return fetch(input, init);

  const { ProxyAgent } = await import("undici");
  return fetch(input, {
    ...init,
    dispatcher: new ProxyAgent(proxy),
  } as RequestInit & { dispatcher: unknown });
};

const requiredEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

export const googleOAuthEnabled = () =>
  Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim());

export const getGoogleRedirectUri = () => {
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (!appUrl) throw new Error("GOOGLE_OAUTH_REDIRECT_URI or NEXT_PUBLIC_APP_URL is required");
  return `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`;
};

export const createGoogleOAuthState = () => randomBytes(24).toString("base64url");

export const buildGoogleOAuthUrl = (state: string) => {
  const params = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
};

export const exchangeGoogleCode = async (code: string) => {
  const body = new URLSearchParams({
    code,
    client_id: requiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirect_uri: getGoogleRedirectUri(),
    grant_type: "authorization_code",
  });

  const response = await googleFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(typeof payload.error_description === "string" ? payload.error_description : "Google token exchange failed");
  }

  return payload.access_token as string;
};

export const fetchGoogleUserInfo = async (accessToken: string): Promise<GoogleUserInfo> => {
  const response = await googleFetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error("Google userinfo request failed");
  }

  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    typeof payload.email_verified !== "boolean"
  ) {
    throw new Error("Google userinfo response is incomplete");
  }

  return payload as GoogleUserInfo;
};
