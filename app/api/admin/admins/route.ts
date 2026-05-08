import { NextResponse } from "next/server";

import { listAdminUsers, promoteUserToAdminByEmail, requireAdmin, updateUserRole } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: error === "Forbidden: admin only" ? 403 : 401 });

  try {
    const admins = await listAdminUsers();
    return NextResponse.json({ admins });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Query failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: error === "Forbidden: admin only" ? 403 : 401 });

  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body.email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const result = await promoteUserToAdminByEmail(body.email);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.error === "User not found" ? 404 : 400 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { userId: adminId, error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: error === "Forbidden: admin only" ? 403 : 401 });

  try {
    const { searchParams } = new URL(request.url);
    const targetId = searchParams.get("id");
    if (!targetId) return NextResponse.json({ error: "Admin id is required" }, { status: 400 });

    const result = await updateUserRole(adminId, targetId, "student");
    if (result.error) return NextResponse.json({ error: result.error }, { status: 403 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Update failed" }, { status: 500 });
  }
}
