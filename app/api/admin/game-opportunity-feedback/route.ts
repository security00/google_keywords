import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import {
  deleteGameOpportunityFeedback,
  listGameOpportunityFeedback,
  upsertGameOpportunityFeedback,
} from "@/lib/game-opportunity-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;
  if (!principal.userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const feedback = await listGameOpportunityFeedback(principal.userId);
    return NextResponse.json({ feedback });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;
  if (!principal.userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    await upsertGameOpportunityFeedback(principal.userId, {
      opportunityId: typeof body.opportunityId === "string" ? body.opportunityId : "",
      keyword: typeof body.keyword === "string" ? body.keyword : "",
      verdict: typeof body.verdict === "string" ? body.verdict : "",
      note: typeof body.note === "string" ? body.note : null,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    const status = message.includes("required") || message.includes("Invalid") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;
  if (!principal.userId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    await deleteGameOpportunityFeedback(principal.userId, searchParams.get("opportunityId") || "");
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed";
    const status = message.includes("required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
