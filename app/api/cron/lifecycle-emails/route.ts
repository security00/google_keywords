import { NextResponse } from "next/server";

import { isCronRequest } from "@/lib/authz";
import { runLifecycleEmailCron } from "@/lib/lifecycle-emails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handleCronRun = async (request: Request) => {
  if (!(await isCronRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runLifecycleEmailCron();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron/lifecycle-emails]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
};

export async function POST(request: Request) {
  return handleCronRun(request);
}

export async function GET(request: Request) {
  return handleCronRun(request);
}
