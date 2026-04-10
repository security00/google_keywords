import { NextResponse } from "next/server";

import { requireAdmin, listInviteCodes, deleteInviteCode } from "@/lib/admin";
import { generateInviteCodes } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/invite-codes — 列出所有邀请码
export async function GET(request: Request) {
  const { error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: error === "Forbidden: admin only" ? 403 : 401 });

  try {
    const codes = await listInviteCodes();
    return NextResponse.json({ codes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Query failed" }, { status: 500 });
  }
}

// POST /api/admin/invite-codes — 生成新邀请码
export async function POST(request: Request) {
  const { userId, error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: error === "Forbidden: admin only" ? 403 : 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body?.count) || 1, 1), 100);
    const maxUsesPerCode = Math.min(Math.max(Number(body?.maxUsesPerCode) || 1, 1), 100);
    const expiresInDays = body?.expiresInDays ? Number(body.expiresInDays) : null;
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const codes = await generateInviteCodes(userId, count, maxUsesPerCode, expiresAt);
    return NextResponse.json({ codes, count: codes.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unexpected error" }, { status: 500 });
  }
}

// DELETE /api/admin/invite-codes — 撤销邀请码
export async function DELETE(request: Request) {
  const { error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: error === "Forbidden: admin only" ? 403 : 401 });

  try {
    const body = await request.json().catch(() => ({}));
    if (!body.code) return NextResponse.json({ error: "code is required" }, { status: 400 });
    await deleteInviteCode(body.code);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Delete failed" }, { status: 500 });
  }
}
