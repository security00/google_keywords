import { NextRequest, NextResponse } from "next/server";

import { createHash } from "crypto";
import { createPasswordHash } from "@/lib/auth";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/reset-password — 用 token 重置密码
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { token, newPassword } = body;

  if (!token || !newPassword) {
    return NextResponse.json({ error: "Token and new password are required" }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");

  // 查找有效 token
  const { rows: tokens } = await d1Query<{
    id: number;
    user_id: string;
    expires_at: string;
    used: number;
  }>(
    "SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token_hash = ? AND used = 0",
    [tokenHash]
  );

  if (!tokens || tokens.length === 0) {
    return NextResponse.json({ error: "Invalid or expired reset link" }, { status: 400 });
  }

  const tokenRow = tokens[0];
  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: "Reset link has expired" }, { status: 400 });
  }

  // 更新密码
  const hash = await createPasswordHash(newPassword);
  await d1Query("UPDATE auth_users_v2 SET password_hash = ? WHERE id = ?", [
    hash,
    tokenRow.user_id,
  ]);

  // 标记 token 已用
  await d1Query("UPDATE password_reset_tokens SET used = 1 WHERE id = ?", [tokenRow.id]);

  return NextResponse.json({ success: true });
}
