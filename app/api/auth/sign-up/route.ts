import { NextResponse } from "next/server";

import { createSession, createUser, setSessionCookie } from "@/lib/auth";
import { rejectIfAuthRateLimited } from "@/lib/auth-rate-limit";
import { rejectInvalidTurnstile } from "@/lib/turnstile";
import {
  INVITE_SIGNUP_TRIAL_DAYS,
  PUBLIC_SIGNUP_TRIAL_DAYS,
  isPublicSignupEnabled,
} from "@/lib/public-signup";
import { validateInviteCode, consumeInviteCode } from "@/lib/usage";

export const runtime = "nodejs";

const SHARED_REGISTRATION_TOKEN = process.env.SHARED_REGISTRATION_TOKEN?.trim() ?? "";
const REGISTRATION_UNAVAILABLE_MESSAGE = "无法完成注册。请尝试登录或使用其他邮箱。";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";
    const registrationToken =
      typeof body?.registrationToken === "string" ? body.registrationToken.trim() : "";
    const turnstileToken = body?.turnstileToken;

    const limited = await rejectIfAuthRateLimited({
      scope: "sign_up",
      request,
      email,
    });
    if (limited) return limited;

    const turnstileError = await rejectInvalidTurnstile(turnstileToken, request);
    if (turnstileError) return turnstileError;

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

    const publicSignup = isPublicSignupEnabled();

    if (!usingSharedRegistration) {
      if (registrationToken) {
        return NextResponse.json({ error: "注册链接无效或已失效" }, { status: 400 });
      }
      if (inviteCode) {
        const codeCheck = await validateInviteCode(inviteCode);
        if (!codeCheck.valid) {
          return NextResponse.json({ error: codeCheck.error || "邀请码无效" }, { status: 400 });
        }
      } else if (!publicSignup) {
        return NextResponse.json({ error: "请输入邀请码" }, { status: 400 });
      }
    }

    const trialDays = inviteCode ? INVITE_SIGNUP_TRIAL_DAYS : PUBLIC_SIGNUP_TRIAL_DAYS;
    const user = await createUser(email, password, {
      role: "student",
      trialDays,
      activateTrial: !usingSharedRegistration,
    });

    if (usingSharedRegistration) {
      return NextResponse.json({
        user,
        requiresActivation: true,
        message: "注册成功，等待管理员批量开通 90 天使用期",
      });
    }

    if (inviteCode) {
      await consumeInviteCode(inviteCode, user.id);
    }

    const session = await createSession(user.id);
    const response = NextResponse.json({
      user,
      expiresAt: session.expiresAt.toISOString(),
      requiresActivation: false,
      message: `注册成功，免费试用 ${trialDays} 天`,
    });

    return setSessionCookie(response, session.token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message === "该邮箱已注册" || message.includes("UNIQUE constraint failed")) {
      return NextResponse.json(
        { error: REGISTRATION_UNAVAILABLE_MESSAGE },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
