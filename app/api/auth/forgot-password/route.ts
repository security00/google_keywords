import { NextRequest, NextResponse } from "next/server";

import { createHash, randomBytes } from "crypto";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/forgot-password — 发送重置邮件
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email } = body;

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // 查找用户
  const { rows: users } = await d1Query<{ id: string }>(
    "SELECT id FROM auth_users_v2 WHERE email = ?",
    [email.trim().toLowerCase()]
  );
  if (!users || users.length === 0) {
    // 不暴露用户是否存在
    return NextResponse.json({ success: true });
  }

  // 生成 token
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 分钟

  await d1Query(
    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
    [users[0].id, tokenHash, expiresAt]
  );

  // 发邮件
  const baseUrl = process.env.PUBLIC_BASE_URL || "https://discoverkeywords.co";
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("[forgot-password] RESEND_API_KEY not configured");
    return NextResponse.json({ error: "Email service not configured" }, { status: 500 });
  }

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "DiscoverKeywords <noreply@discoverkeywords.co>",
        to: email.trim().toLowerCase(),
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

    if (!resendRes.ok) {
      const err = await resendRes.text();
      console.error("[forgot-password] Resend error:", err);
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }
  } catch (e) {
    console.error("[forgot-password] Email error:", e);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
