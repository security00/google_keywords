import { NextResponse } from "next/server";

import { requireAdmin, getUserDetail, updateUserRole } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/users/[id]
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: error === "Forbidden: admin only" ? 403 : 401 });

  const { id } = await params;
  try {
    const user = await getUserDetail(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    // Note: requireAdmin returns userId but we don't expose it in GET for security
    return NextResponse.json({ user });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Query failed" }, { status: 500 });
  }
}

// PATCH /api/admin/users/[id] — 修改角色或封禁
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: error === "Forbidden: admin only" ? 403 : 401 });

  const { id } = await params;
  const { userId: adminId, error: adminError } = await requireAdmin();
  if (adminError) return NextResponse.json({ error: adminError }, { status: adminError === "Forbidden: admin only" ? 403 : 401 });

  try {
    const body = await request.json().catch(() => ({}));

    // Reset password
    if (body.password) {
      const { createPasswordHash } = await import("@/lib/auth");
      if (typeof body.password !== "string" || body.password.length < 6) {
        return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
      }
      const hash = await createPasswordHash(body.password);
      const { d1Query } = await import("@/lib/d1");
      await d1Query("UPDATE auth_users_v2 SET password_hash = ? WHERE id = ?", [hash, id]);
      return NextResponse.json({ success: true, message: "Password reset" });
    }

    if (!body.role || !["admin", "student", "banned"].includes(body.role)) {
      return NextResponse.json({ error: "Invalid role. Must be admin, student, or banned" }, { status: 400 });
    }
    const result = await updateUserRole(adminId, id, body.role);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 403 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 500 });
  }
}
