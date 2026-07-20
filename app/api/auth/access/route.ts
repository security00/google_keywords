import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/auth";
import { checkEffectiveAccess } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/access
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await checkEffectiveAccess(user.id);

    return NextResponse.json({
      userId: user.id,
      email: user.email,
      role: access.allowed ? access.user.role : user.role,
      entitlement: {
        allowed: access.entitlement.allowed,
        source: access.entitlement.source,
        planKey: access.entitlement.planKey,
        status: access.entitlement.status,
        expiresAt: access.entitlement.expiresAt,
      },
      trial: access.allowed
        ? { active: access.trial.active, daysLeft: access.trial.daysLeft, expiresAt: access.trial.expiresAt }
        : undefined,
      quota: access.allowed
        ? { used: access.quota.used, limit: access.quota.limit }
        : undefined,
      blocked: !access.allowed,
      blockedReason: !access.allowed ? access.reason : undefined,
      blockedCode: !access.allowed ? access.code : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
