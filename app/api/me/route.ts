import { NextRequest, NextResponse } from "next/server";
import { isAuthzError, requireUser } from "@/lib/authz";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const principal = await requireUser(req, { allowLegacyQueryKey: true });
  if (isAuthzError(principal)) return principal;

  const userId = principal.userId!;

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
