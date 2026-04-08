import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/auth";
import { getUserWithMeta, generateInviteCodes } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/invite-codes
// Body: { count: number, maxUsesPerCode?: number, expiresInDays?: number }
export async function POST(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const meta = await getUserWithMeta(user.id);
    if (!meta || meta.role !== "admin") {
      return NextResponse.json({ error: "Forbidden: admin only" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body?.count) || 1, 1), 100);
    const maxUsesPerCode = Math.min(Math.max(Number(body?.maxUsesPerCode) || 1, 1), 100);
    const expiresInDays = body?.expiresInDays ? Number(body.expiresInDays) : null;
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const codes = await generateInviteCodes(user.id, count, maxUsesPerCode, expiresAt);

    return NextResponse.json({ codes, count: codes.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
