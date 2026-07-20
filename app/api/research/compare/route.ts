import { NextResponse } from "next/server";
import { isAuthzError, requireEffectiveUser } from "@/lib/authz";
import { handleComparePost } from "./compare-job-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  try {
    const principal = await requireEffectiveUser(request, {
      allowLegacyQueryKey: true,
    });
    if (isAuthzError(principal)) return principal;
    const isStudent = principal.access.user.role === "student";

    return await handleComparePost(request, principal.userId, isStudent);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (debug) {
      console.log("[api/compare] error", message);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
