import { NextResponse } from "next/server";

import { getAuthUser } from "@/lib/auth";
import { fetchSessionPayload } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "Missing session id" }, { status: 400 });
    }

    const payload = await fetchSessionPayload(user.id, id);
    if (!payload) {
      return NextResponse.json({ session: null }, { status: 404 });
    }

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
