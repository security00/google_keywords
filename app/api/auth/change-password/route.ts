import { NextRequest, NextResponse } from "next/server";

import { authenticate } from "@/lib/auth_middleware";
import { createPasswordHash, verifyPassword } from "@/lib/auth";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/change-password
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current password and new password are required" }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const { rows } = await d1Query<{ password_hash: string }>(
    "SELECT password_hash FROM auth_users_v2 WHERE id = ?",
    [auth.userId]
  );
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const valid = await verifyPassword(currentPassword, rows[0].password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
  }

  const hash = await createPasswordHash(newPassword);
  await d1Query("UPDATE auth_users_v2 SET password_hash = ? WHERE id = ?", [hash, auth.userId]);

  return NextResponse.json({ success: true });
}
