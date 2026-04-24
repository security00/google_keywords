import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth_middleware";
import { checkStudentAccess } from "@/lib/usage";
import { handleExpandPost } from "./expand-job-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const debug = process.env.DEBUG_API_LOGS === "true";
  const startedAt = Date.now();
  try {
    const auth = await authenticate(request as Parameters<typeof authenticate>[0]);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
    }

    const access = await checkStudentAccess(auth.userId!);
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.reason, code: access.code },
        { status: access.code === "trial_expired" ? 403 : 429 }
      );
    }
    const isStudent = access.user.role === "student";

    return await handleExpandPost(request, auth.userId!, isStudent);
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
