import { NextResponse } from "next/server";

import { createSession, createUser, setSessionCookie } from "@/lib/auth";
import { validateInviteCode, consumeInviteCode } from "@/lib/usage";

export const runtime = "nodejs";

const SHARED_REGISTRATION_TOKEN = process.env.SHARED_REGISTRATION_TOKEN?.trim() ?? "";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";
    const registrationToken =
      typeof body?.registrationToken === "string" ? body.registrationToken.trim() : "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 }
      );
    }

    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "密码至少 8 位" }, { status: 400 });
    }

    const usingSharedRegistration =
      Boolean(registrationToken) &&
      Boolean(SHARED_REGISTRATION_TOKEN) &&
      registrationToken === SHARED_REGISTRATION_TOKEN;

    if (!usingSharedRegistration) {
      if (registrationToken) {
        return NextResponse.json({ error: "注册链接无效或已失效" }, { status: 400 });
      }
      if (!inviteCode) {
        return NextResponse.json({ error: "请输入邀请码" }, { status: 400 });
      }
      const codeCheck = await validateInviteCode(inviteCode);
      if (!codeCheck.valid) {
        return NextResponse.json({ error: codeCheck.error || "邀请码无效" }, { status: 400 });
      }
    }

    const user = await createUser(email, password, {
      role: "student",
      trialDays: 90,
      activateTrial: !usingSharedRegistration,
    });

    if (usingSharedRegistration) {
      return NextResponse.json({
        user,
        requiresActivation: true,
        message: "注册成功，等待管理员批量开通 90 天使用期",
      });
    }

    await consumeInviteCode(inviteCode, user.id);

    const session = await createSession(user.id);
    const response = NextResponse.json({
      user,
      expiresAt: session.expiresAt.toISOString(),
      requiresActivation: false,
      message: "注册成功，免费试用 90 天",
    });

    return setSessionCookie(response, session.token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message === "该邮箱已注册" || message.includes("UNIQUE constraint failed")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
