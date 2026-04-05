import { NextResponse } from "next/server";

import { createSession, setSessionCookie, validateUser } from "@/lib/auth";

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

    const user = await validateUser(email, password);
    if (!user) {
      return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
    }

    const session = await createSession(user.id);
    const response = NextResponse.json({
      user,
      expiresAt: session.expiresAt.toISOString(),
    });

    return setSessionCookie(response, session.token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
