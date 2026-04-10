import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/auth";
import { checkStudentAccess } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/access
export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = await checkStudentAccess(user.id);

    return NextResponse.json({
      userId: user.id,
      email: user.email,
      role: access.allowed ? (access as any).user.role : user.role,  // 始终返回 role（用于权限检查）
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
