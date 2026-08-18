import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin";
import { loadSaasFunnelSnapshot } from "@/lib/saas-funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) {
    return NextResponse.json(
      { error },
      { status: error === "Forbidden: admin only" ? 403 : 401 }
    );
  }

  try {
    return NextResponse.json(await loadSaasFunnelSnapshot(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
