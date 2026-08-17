import "server-only";

import { NextResponse } from "next/server";

import { getClientIp } from "@/lib/auth-rate-limit";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const TURNSTILE_FAILED_MESSAGE = "验证失败，请重试";

type SiteverifyResult = {
  success?: boolean;
};

const readOptionalEnv = (name: string): string => {
  const value = (process.env as Record<string, string | undefined>)[name];
  return typeof value === "string" ? value.trim() : "";
};

export const isTurnstileEnforced = (): boolean =>
  Boolean(readOptionalEnv("TURNSTILE_SECRET_KEY"));

export const verifyTurnstileToken = async (
  token: unknown,
  request: Request
): Promise<boolean> => {
  const secret = readOptionalEnv("TURNSTILE_SECRET_KEY");
  if (!secret) return true;

  if (typeof token !== "string" || token.trim().length === 0) {
    return false;
  }

  const body = new URLSearchParams({
    secret,
    response: token.trim(),
    remoteip: getClientIp(request),
  });

  const response = await fetch(SITEVERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) return false;

  const result = (await response.json().catch(() => null)) as SiteverifyResult | null;
  return result?.success === true;
};

export const rejectInvalidTurnstile = async (
  token: unknown,
  request: Request
): Promise<NextResponse | null> => {
  try {
    const ok = await verifyTurnstileToken(token, request);
    if (ok) return null;
    return NextResponse.json({ error: TURNSTILE_FAILED_MESSAGE }, { status: 400 });
  } catch {
    return NextResponse.json({ error: TURNSTILE_FAILED_MESSAGE }, { status: 400 });
  }
};
