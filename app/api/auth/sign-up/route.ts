import { NextResponse } from "next/server";

import { createSession, createUser, setSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 }
      );
    }

    if (!email.includes("@")) {
      return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "密码至少 8 位" }, { status: 400 });
    }

    const user = await createUser(email, password);
    const session = await createSession(user.id);

    const response = NextResponse.json({
      user,
      expiresAt: session.expiresAt.toISOString(),
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
