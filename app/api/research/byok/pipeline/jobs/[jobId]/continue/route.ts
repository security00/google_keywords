import { handlePipelineContinue } from "@/lib/byok/pipeline-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = async (
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) => {
  const { jobId } = await context.params;
  return handlePipelineContinue(request, jobId);
};
