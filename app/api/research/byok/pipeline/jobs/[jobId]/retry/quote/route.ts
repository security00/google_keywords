import { handlePipelineRetryQuote } from "@/lib/byok/pipeline-api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  return handlePipelineRetryQuote(request, jobId);
}
