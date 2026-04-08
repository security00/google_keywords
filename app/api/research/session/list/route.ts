import { NextResponse } from "next/server";

import { authenticate } from "@/lib/auth_middleware";
import { listSessions } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await authenticate(request as any);
    if (!auth.authenticated) { return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 }); }
    const user = { id: auth.userId! };
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 20, 1), 100) : 20;

    const sessions = await listSessions(user.id, limit);

    return NextResponse.json({ sessions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
