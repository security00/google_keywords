import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth_middleware";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
  }

  const userId = auth.userId!;

  try {
    const { rows } = await d1Query<{ role: string; email: string }>(
      "SELECT role, email FROM auth_users_v2 WHERE id = ?",
      [userId]
    );

    if (!rows.length) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: userId,
      role: rows[0].role,
      email: rows[0].email,
    });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
