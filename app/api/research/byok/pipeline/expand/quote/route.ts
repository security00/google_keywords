import { handlePipelineQuote } from "@/lib/byok/pipeline-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) => handlePipelineQuote(request, "expand");
