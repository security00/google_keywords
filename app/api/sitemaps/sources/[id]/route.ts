import { NextResponse } from "next/server";

import { d1Query } from "@/lib/d1";
import { getAuthUser } from "@/lib/auth";
import {
  DEFAULT_CHECK_INTERVAL_MINUTES,
  ensureSitemapSourcesColumns,
  normalizeCheckIntervalMinutes,
} from "@/lib/sitemap-discovery";

const parseCheckIntervalMinutes = (value: unknown) => {
  const normalized =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : undefined;
  return normalizeCheckIntervalMinutes(normalized, DEFAULT_CHECK_INTERVAL_MINUTES);
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureSitemapSourcesColumns();
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const fields: string[] = [];
    const paramsList: unknown[] = [];

    if (typeof body?.name === "string") {
      fields.push("name = ?");
      paramsList.push(body.name.trim());
    }

    if (typeof body?.sitemapUrl === "string") {
      fields.push("sitemap_url = ?");
      paramsList.push(body.sitemapUrl.trim());
      fields.push("etag = ?");
      paramsList.push(null);
      fields.push("last_modified = ?");
      paramsList.push(null);
      fields.push("last_checked_at = ?");
      paramsList.push(null);
    }

    if (typeof body?.enabled === "boolean") {
      fields.push("enabled = ?");
      paramsList.push(body.enabled ? 1 : 0);
    }

    if (typeof body?.rulesJson === "string") {
      fields.push("rules_json = ?");
      paramsList.push(body.rulesJson.trim());
    }

    if (body?.checkIntervalMinutes !== undefined) {
      const checkIntervalMinutes = parseCheckIntervalMinutes(body?.checkIntervalMinutes);
      const nextCheckAt = new Date(Date.now() + checkIntervalMinutes * 60_000).toISOString();
      fields.push("check_interval_minutes = ?");
      paramsList.push(checkIntervalMinutes);
      fields.push("next_check_at = ?");
      paramsList.push(nextCheckAt);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { id } = await context.params;
    fields.push("updated_at = ?");
    paramsList.push(new Date().toISOString());
    paramsList.push(id, user.id);

    await d1Query(
      `UPDATE sitemap_sources SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
      paramsList
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: sourceId } = await context.params;

    await d1Query("DELETE FROM discovered_keywords WHERE source_id = ? AND user_id = ?", [
      sourceId,
      user.id,
    ]);
    await d1Query("DELETE FROM sitemap_entries WHERE source_id = ? AND user_id = ?", [
      sourceId,
      user.id,
    ]);
    await d1Query("DELETE FROM sitemap_sources WHERE id = ? AND user_id = ?", [
      sourceId,
      user.id,
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
