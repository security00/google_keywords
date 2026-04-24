import { NextRequest, NextResponse } from "next/server";

import { createPasswordHash } from "@/lib/auth";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/reset-password — 忘记密码重置（无需登录）
// 需要邮箱 + 邀请码验证身份
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email, inviteCode, newPassword } = body;

  if (!email || !inviteCode || !newPassword) {
    return NextResponse.json(
      { error: "Email, invite code, and new password are required" },
      { status: 400 }
    );
  }

  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  // 验证邀请码是否有效
  const { rows: codeRows } = await d1Query<{ code: string }>(
    "SELECT code FROM invite_codes WHERE code = ?",
    [inviteCode]
  );
  if (!codeRows || codeRows.length === 0) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 403 });
  }

  // 查找用户
  const { rows: users } = await d1Query<{ id: string }>(
    "SELECT id FROM auth_users_v2 WHERE email = ?",
    [email]
  );
  if (!users || users.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // 重置密码
  const hash = await createPasswordHash(newPassword);
  await d1Query("UPDATE auth_users_v2 SET password_hash = ? WHERE id = ?", [
    hash,
    users[0].id,
  ]);

  return NextResponse.json({ success: true });
}
