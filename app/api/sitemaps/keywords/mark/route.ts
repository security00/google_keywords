import { NextResponse } from "next/server";

import { d1Query } from "@/lib/d1";
import { getAuthUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

export async function POST(request: Request) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const status = typeof body?.status === "string" ? body.status : "";

    if (!ids.length || !status) {
      return NextResponse.json({ error: "ids and status are required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    let updated = 0;

  for (const chunk of chunkArray(ids, 80)) {
    const placeholders = chunk.map(() => "?").join(", ");
    const { meta } = await d1Query(
      `UPDATE discovered_keywords SET status = ?, updated_at = ? WHERE user_id = ? AND id IN (${placeholders})`,
      [status, now, user.id, ...chunk]
    );
      if (meta?.changes) updated += meta.changes;
    }

    return NextResponse.json({ updated });
  } catch (error) {
    console.error("[sitemaps/keywords/mark]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
