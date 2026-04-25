import { NextResponse } from "next/server";

import { listRecentPrecomputeHealth, writePrecomputeHealth } from "@/lib/admin_health";
import { activateUserTrials, listActiveUsers, listPendingUsers, listUsers, requireAdmin } from "@/lib/admin";
import { validateApiKey } from "@/lib/api_keys";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isCronAuthorized = (request: Request) => {
  const secret = process.env.CRON_SECRET || process.env.GK_CRON_SECRET;
  const externalSecret = process.env.EXTERNAL_CRON_SECRET;
  if (!secret && !externalSecret) return false;
  const headerSecret = request.headers.get("x-cron-secret");
  if (secret && headerSecret === secret) return true;
  if (externalSecret && headerSecret === externalSecret) return true;

  const authHeader = request.headers.get("authorization");
  if (secret && authHeader === `Bearer ${secret}`) return true;
  if (externalSecret && authHeader === `Bearer ${externalSecret}`) return true;

  return false;
};

const hasAdminApiKey = async (request: Request) => {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  const apiKey = authHeader.slice(7).trim();
  const result = await validateApiKey(apiKey, request);
  if (!result.valid || !result.userId) return false;
  const { rows } = await d1Query<{ role: string }>(
    `SELECT role FROM auth_users_v2 WHERE id = ? LIMIT 1`,
    [result.userId]
  );
  return rows[0]?.role === "admin";
};

// GET /api/admin/users
export async function GET(request: Request) {
  const { error } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status: error === "Forbidden: admin only" ? 403 : 401 });

  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("view") === "health") {
      const items = await listRecentPrecomputeHealth(7);
      return NextResponse.json({
        latest: items[0] ?? null,
        items,
      });
    }
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get("pageSize") || "20", 10) || 20));
    const filter = searchParams.get("filter");
    const search = searchParams.get("search") || "";
    const result = filter === "pending"
      ? await listPendingUsers(page, pageSize, search)
      : filter === "active"
        ? await listActiveUsers(page, pageSize, search)
        : await listUsers(page, pageSize, search);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Query failed" }, { status: 500 });
  }
}

// POST /api/admin/users
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  if (body?.action === "sync_precompute_health") {
    const authorized =
      isCronAuthorized(request) || (await hasAdminApiKey(request));
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      typeof body?.sharedDate !== "string" ||
      typeof body?.status !== "string" ||
      typeof body?.stage !== "string"
    ) {
      return NextResponse.json({ error: "Invalid health payload" }, { status: 400 });
    }
    try {
      await writePrecomputeHealth({
        sharedDate: body.sharedDate,
        status: body.status,
        stage: body.stage,
        updatedAt: body.updatedAt ?? null,
        stageStartedAt: body.stageStartedAt ?? null,
        expandCompletedAt: body.expandCompletedAt ?? null,
        compareCompletedAt: body.compareCompletedAt ?? null,
        intentCompletedAt: body.intentCompletedAt ?? null,
        expandJobId: body.expandJobId ?? null,
        compareJobId: body.compareJobId ?? null,
        intentJobId: body.intentJobId ?? null,
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Health sync failed" },
        { status: 500 }
      );
    }
  }

  const { error } = await requireAdmin();
  if (error) {
    return NextResponse.json(
      { error },
      { status: error === "Forbidden: admin only" ? 403 : 401 }
    );
  }

  try {
    if (body?.action !== "activate_trial") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const userIds = Array.isArray(body?.userIds)
      ? body.userIds.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const trialDays =
      typeof body?.trialDays === "number" && Number.isFinite(body.trialDays) && body.trialDays > 0
        ? Math.floor(body.trialDays)
        : 90;

    if (userIds.length === 0) {
      return NextResponse.json({ error: "请选择要开通的用户" }, { status: 400 });
    }

    const result = await activateUserTrials(userIds, trialDays);
    return NextResponse.json({
      updated: result.updated,
      message: `已开通 ${result.updated} 个账号的 ${trialDays} 天使用期`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Request failed" },
      { status: 500 }
    );
  }
}
