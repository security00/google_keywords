import { NextResponse } from "next/server";

import { isAuthzError, requireAdminRequest } from "@/lib/authz";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses = new Set(["new", "approved", "rejected", "trend_pass", "trend_fail", "serp_pass", "serp_fail"]);

const feedbackForStatus: Record<string, "worth" | "not_worth" | undefined> = {
  approved: "worth",
  rejected: "not_worth",
  trend_pass: "worth",
  trend_fail: "not_worth",
  serp_pass: "worth",
  serp_fail: "not_worth",
};

const stableFeedbackId = (candidateId: string, status: string, note: string) =>
  `radar_${candidateId}_${status}_${Buffer.from(note).toString("base64url").slice(0, 16)}`;

export async function PATCH(request: Request) {
  const principal = await requireAdminRequest(request);
  if (isAuthzError(principal)) return principal;

  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id.trim() : "";
    const status = typeof body.status === "string" ? body.status.trim() : undefined;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const rejectReason = typeof body.rejectReason === "string" ? body.rejectReason.trim() : null;

    if (!id) {
      return NextResponse.json({ error: "Candidate id is required" }, { status: 400 });
    }
    if (status && !allowedStatuses.has(status)) {
      return NextResponse.json({ error: "Invalid candidate status" }, { status: 400 });
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (status) {
      sets.push("status = ?");
      params.push(status);
      sets.push("reject_reason = ?");
      params.push(status === "rejected" || status === "trend_fail" || status === "serp_fail" ? rejectReason || "operator_rejected" : null);
    }
    if (typeof body.note === "string") {
      sets.push("operator_note = ?");
      params.push(note || null);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "No candidate changes provided" }, { status: 400 });
    }

    sets.push("updated_at = datetime('now')");
    params.push(id);

    const result = await d1Query<{ id: string }>(
      `UPDATE game_radar_candidates SET ${sets.join(", ")} WHERE id = ? RETURNING id`,
      params
    );
    if (!result.rows.length) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    if (status && feedbackForStatus[status]) {
      const feedbackNote = note || rejectReason || status;
      await d1Query(
        `INSERT OR IGNORE INTO game_radar_feedback (id, candidate_id, verdict, note)
         VALUES (?, ?, ?, ?)`,
        [stableFeedbackId(id, status, feedbackNote), id, feedbackForStatus[status], feedbackNote]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Candidate update failed" },
      { status: 500 }
    );
  }
}
