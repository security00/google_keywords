import { NextResponse } from "next/server";

import {
  listRecentPrecomputeHealth,
  type PrecomputeHealth,
  writePrecomputeHealth,
} from "@/lib/admin_health";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isCronAuthorized = (request: Request) => {
  const envSecret =
    process.env.GK_CRON_SECRET || process.env.EXTERNAL_CRON_SECRET || "";
  if (!envSecret) return false;
  const headerSecret = request.headers.get("x-cron-secret");
  return Boolean(headerSecret && headerSecret === envSecret);
};

const isValidHealth = (value: unknown): value is PrecomputeHealth => {
  if (!value || typeof value !== "object") return false;
  const health = value as Record<string, unknown>;
  return (
    typeof health.sharedDate === "string" &&
    health.sharedDate.length > 0 &&
    typeof health.status === "string" &&
    health.status.length > 0 &&
    typeof health.stage === "string" &&
    health.stage.length > 0
  );
};

export async function GET() {
  const { error } = await requireAdmin();
  if (error) {
    return NextResponse.json(
      { error },
      { status: error === "Forbidden: admin only" ? 403 : 401 }
    );
  }

  try {
    const items = await listRecentPrecomputeHealth(7);
    return NextResponse.json({
      latest: items[0] ?? null,
      items,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Load failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!isValidHealth(body)) {
      return NextResponse.json(
        { error: "Invalid health payload" },
        { status: 400 }
      );
    }

    await writePrecomputeHealth(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Write failed" },
      { status: 500 }
    );
  }
}
