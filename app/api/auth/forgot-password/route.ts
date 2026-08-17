import { NextRequest, NextResponse } from "next/server";

import { createHash, randomBytes } from "crypto";
import { rejectIfAuthRateLimited } from "@/lib/auth-rate-limit";
import { d1Query } from "@/lib/d1";
import { appBaseUrl, sendTransactionalEmail } from "@/lib/email";
import { rejectInvalidTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const ACCEPTED_MESSAGE = { success: true as const };

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const sendResetEmail = async (email: string, resetUrl: string) => {
  await sendTransactionalEmail({
    to: email,
    subject: "重置您的密码 — DiscoverKeywords",
    html: `
<div style="max-width:480px;margin:0 auto;font-family:system-ui,sans-serif;padding:32px 16px">
  <h2 style="font-size:20px;margin-bottom:16px">重置密码</h2>
  <p style="color:#555;line-height:1.6">您正在重置 DiscoverKeywords 账号的密码。点击下方按钮设置新密码：</p>
  <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:500;margin:16px 0">重置密码</a>
  <p style="color:#888;font-size:13px;line-height:1.6">此链接 30 分钟内有效。如果您没有请求重置密码，请忽略此邮件。</p>
</div>`,
  });
};

// POST /api/auth/forgot-password — 发送重置邮件
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email : "";
  const turnstileToken = body?.turnstileToken;

  const limited = await rejectIfAuthRateLimited({
    scope: "forgot_password",
    request: req,
    email,
  });
  if (limited) return limited;

  const turnstileError = await rejectInvalidTurnstile(turnstileToken, req);
  if (turnstileError) return turnstileError;

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(email);

  const { rows: users } = await d1Query<{ id: string }>(
    "SELECT id FROM auth_users_v2 WHERE email = ?",
    [normalizedEmail]
  );
  if (!users || users.length === 0) {
    return NextResponse.json(ACCEPTED_MESSAGE);
  }

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
  const userId = users[0].id;

  await d1Query(
    "DELETE FROM password_reset_tokens WHERE user_id = ? AND used = 0",
    [userId]
  );

  await d1Query(
    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    [userId, tokenHash, expiresAt]
  );

  const resetUrl = `${appBaseUrl()}/reset-password?token=${token}`;

  try {
    await sendResetEmail(normalizedEmail, resetUrl);
  } catch {
    await d1Query(
      "DELETE FROM password_reset_tokens WHERE user_id = ? AND token_hash = ?",
      [userId, tokenHash]
    );
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json(ACCEPTED_MESSAGE);
}
