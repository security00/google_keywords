import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth_middleware";
import { handleCompareStatusGet } from "./compare-status-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await authenticate(request as Parameters<typeof authenticate>[0]);
    if (!auth.authenticated) { return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 }); }
    const user = { id: auth.userId! };
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return await handleCompareStatusGet(request, user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
