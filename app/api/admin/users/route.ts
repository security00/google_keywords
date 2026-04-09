import { NextResponse } from "next/server";

import { requireAdmin, listUsers } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/users
export async function GET(request: Request) {
  const { error } = await requireAdmin(request);
  if (error) return NextResponse.json({ error }, { status: error === "Forbidden: admin only" ? 403 : 401 });

  try {
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Query failed" }, { status: 500 });
  }
}
