import { NextResponse } from "next/server";
import { isAuthzError, requireEffectiveUser } from "@/lib/authz";
import { handleExpandPost } from "./expand-job-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  const startedAt = Date.now();
  try {
    const principal = await requireEffectiveUser(request, {
      allowLegacyQueryKey: true,
    });
    if (isAuthzError(principal)) return principal;
    const isStudent = principal.access.user.role === "student";

    return await handleExpandPost(request, principal.userId, isStudent);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("[api/expand] error", {
      message,
      tookMs: Date.now() - startedAt,
    });
    if (debug) {
      console.log("[api/expand] error", message);
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
