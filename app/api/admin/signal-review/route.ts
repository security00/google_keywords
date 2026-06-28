import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import {
  getSignalReviewQueue,
  normalizeSignalReviewAction,
  updateSignalReviewCandidate,
} from "@/lib/signal-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 20);
    const queue = await getSignalReviewQueue(searchParams.get("status"), limit);
    return NextResponse.json(queue);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Signal review query failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : "";
    const action = normalizeSignalReviewAction(body.action);
    if (!action) {
      return NextResponse.json({ error: "Invalid signal review action" }, { status: 400 });
    }

    const result = await updateSignalReviewCandidate({
      id,
      action,
      reason: body.reason,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signal review update failed";
    const status = message.includes("required") ? 400 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
