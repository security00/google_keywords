import { NextResponse } from "next/server";

import { isAuthzError, requireEffectiveUser } from "@/lib/authz";
import {
  getResearchPreference,
  updateResearchPreference,
  type ResearchExecutionMode,
} from "@/lib/research-preferences";

export const dynamic = "force-dynamic";

const noStore = (body: unknown, init?: ResponseInit) => {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
};

export async function GET(request: Request) {
  const principal = await requireEffectiveUser(request);
  if (isAuthzError(principal)) return principal;
  try {
    return noStore(await getResearchPreference(principal.userId));
  } catch {
    return noStore({ error: "Preference unavailable", code: "PERSISTENCE_ERROR" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const principal = await requireEffectiveUser(request);
  if (isAuthzError(principal)) return principal;
  if (principal.authMethod !== "cookie") {
    return noStore({ error: "Cookie authentication required", code: "COOKIE_AUTH_REQUIRED" }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return noStore({ error: "Cross-origin request rejected", code: "CROSS_ORIGIN_REQUEST" }, { status: 403 });
  }
  try {
    const body = await request.json() as { executionMode?: ResearchExecutionMode };
    if (Object.keys(body).join(",") !== "executionMode") throw new Error("invalid");
    return noStore(await updateResearchPreference(principal.userId, body.executionMode!));
  } catch {
    return noStore({ error: "Invalid preference", code: "INVALID_REQUEST" }, { status: 400 });
  }
}
