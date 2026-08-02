import { handlePipelineExecute } from "@/lib/byok/pipeline-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) => handlePipelineExecute(request, "expand");
