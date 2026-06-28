import { NextRequest, NextResponse } from "next/server";

import { createHash, randomBytes } from "crypto";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESEND_MAX_ATTEMPTS = 2;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sendResetEmail = async (email: string, resetUrl: string) => {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    throw new Error("RESEND_API_KEY not configured");
  }

  let lastError = "Unknown email error";
  for (let attempt = 1; attempt <= RESEND_MAX_ATTEMPTS; attempt += 1) {
    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "DiscoverKeywords <support@discoverkeywords.co>",
          to: email,
          subject: "重置您的密码 — DiscoverKeywords",
          html: `
<div style="max-width:480px;margin:0 auto;font-family:system-ui,sans-serif;padding:32px 16px">
  <h2 style="font-size:20px;margin-bottom:16px">重置密码</h2>
  <p style="color:#555;line-height:1.6">您正在重置 DiscoverKeywords 账号的密码。点击下方按钮设置新密码：</p>
  <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;font-weight:500;margin:16px 0">重置密码</a>
  <p style="color:#888;font-size:13px;line-height:1.6">此链接 30 分钟内有效。如果您没有请求重置密码，请忽略此邮件。</p>
</div>`,
        }),
      });

      if (resendRes.ok) return;

      lastError = await resendRes.text();
      console.error("[forgot-password] Resend error:", lastError);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unexpected email error";
      console.error("[forgot-password] Email error:", lastError);
    }

    if (attempt < RESEND_MAX_ATTEMPTS) {
      await wait(300);
    }
  }

  throw new Error(lastError);
};

// POST /api/auth/forgot-password — 发送重置邮件
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email } = body;

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(email);

  // 查找用户
  const { rows: users } = await d1Query<{ id: string }>(
    "SELECT id FROM auth_users_v2 WHERE email = ?",
    [normalizedEmail]
  );
  if (!users || users.length === 0) {
    return NextResponse.json(
      { error: "该邮箱未注册，请先注册账号" },
      { status: 404 }
    );
  }

  // 生成 token
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

  // 发邮件
  const baseUrl = process.env.PUBLIC_BASE_URL || "https://discoverkeywords.co";
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  try {
    await sendResetEmail(normalizedEmail, resetUrl);
  } catch {
    await d1Query(
      "DELETE FROM password_reset_tokens WHERE user_id = ? AND token_hash = ?",
      [userId, tokenHash]
    );
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
