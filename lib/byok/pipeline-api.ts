import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

import { requireByokLiveOwner } from "@/lib/byok/api";
import {
  ByokPipelineError,
  executePipelineJob,
  pipelineContinueHeaderName,
  pipelineContinueToken,
  quotePipelineCompare,
  quotePipelineExpand,
  quotePipelineRetry,
  schedulePipelineContinue,
  startPipelineExecution,
  type PipelineCompareInput,
  type PipelineExpandInput,
  type PipelineOperation,
} from "@/lib/byok/pipeline";
import { ByokPipelineAccessError } from "@/lib/byok/pipeline-access";
import { ByokSpendControlError } from "@/lib/byok/spend-controls";

const noStore = (body: unknown, init?: ResponseInit) => {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
};

const errorResponse = (error: unknown) => {
  if (error instanceof ByokPipelineError) {
    return noStore({ error: "BYOK pipeline request rejected", code: error.code }, { status: error.status });
  }
  if (error instanceof ByokPipelineAccessError) {
    const status = error.code === "CONNECTIONS_REQUIRED" || error.code === "CONNECTION_NOT_VERIFIED" ? 409 : 503;
    return noStore({ error: "BYOK Provider connections are not ready", code: error.code }, { status });
  }
  if (error instanceof ByokSpendControlError) {
    return noStore({ error: "BYOK spend control rejected the request", code: error.code }, { status: 409 });
  }
  return noStore({ error: "BYOK pipeline unavailable", code: "INTERNAL_ERROR" }, { status: 503 });
};

const idempotencyKey = (request: Request) => {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(value)) {
    throw new ByokPipelineError("IDEMPOTENCY_KEY_REQUIRED", 400);
  }
  return value;
};

export const handlePipelineQuote = async (request: Request, operation: PipelineOperation) => {
  const owner = await requireByokLiveOwner(request, { mutation: true });
  if (owner instanceof NextResponse) return owner;
  try {
    const key = idempotencyKey(request);
    const body = await request.json() as Record<string, unknown>;
    const allowed = operation === "expand"
      ? new Set(["keywords", "days", "dateFrom", "dateTo", "filterTerms", "filterPrompt"])
      : new Set(["keywords", "benchmark", "days", "dateFrom", "dateTo"]);
    if (Object.keys(body).some((field) => !allowed.has(field))) {
      throw new ByokPipelineError("INVALID_REQUEST", 400);
    }
    if (!Array.isArray(body.keywords)) throw new ByokPipelineError("INVALID_REQUEST", 400);
    const quote = operation === "expand"
      ? await quotePipelineExpand(owner.ownerId, key, {
        keywords: body.keywords,
        days: body.days as number | undefined,
        dateFrom: body.dateFrom as string | undefined,
        dateTo: body.dateTo as string | undefined,
        filterTerms: body.filterTerms as readonly string[] | undefined,
        filterPrompt: body.filterPrompt as string | undefined,
      } satisfies PipelineExpandInput)
      : await quotePipelineCompare(owner.ownerId, key, {
        keywords: body.keywords,
        benchmark: body.benchmark as string,
        days: body.days as number | undefined,
        dateFrom: body.dateFrom as string | undefined,
        dateTo: body.dateTo as string | undefined,
      } satisfies PipelineCompareInput);
    return noStore({ quote });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handlePipelineExecute = async (request: Request, operation: PipelineOperation) => {
  const owner = await requireByokLiveOwner(request, { mutation: true });
  if (owner instanceof NextResponse) return owner;
  try {
    const key = idempotencyKey(request);
    const body = await request.json() as Record<string, unknown>;
    if (
      Object.keys(body).sort().join(",") !== "confirmedEstimatedCostUsd,quoteId,requestHash"
      || typeof body.quoteId !== "string"
      || typeof body.requestHash !== "string"
      || typeof body.confirmedEstimatedCostUsd !== "number"
    ) {
      throw new ByokPipelineError("INVALID_REQUEST", 400);
    }
    const job = await startPipelineExecution({
      ownerId: owner.ownerId,
      operation,
      quoteId: body.quoteId,
      requestHash: body.requestHash,
      confirmedEstimatedCostUsd: body.confirmedEstimatedCostUsd,
      executeIdempotencyKey: key,
    });
    if (job.status === "processing") {
      const { ctx } = await getCloudflareContext({ async: true });
      ctx.waitUntil((async () => {
        const outcome = await executePipelineJob(owner.ownerId, job.jobId);
        if (outcome === "continue") await schedulePipelineContinue(owner.ownerId, job.jobId);
      })());
    }
    return noStore(job, { status: job.status === "processing" ? 202 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handlePipelineContinue = async (request: Request, jobId: string) => {
  try {
    const token = request.headers.get(pipelineContinueHeaderName())?.trim() ?? "";
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const ownerId = typeof body.ownerId === "string" ? body.ownerId.trim() : "";
    const secret = process.env.BYOK_KEK_V1?.trim() ?? "";
    if (!jobId || !ownerId || !token || !secret) {
      throw new ByokPipelineError("INVALID_REQUEST", 400);
    }
    const expected = pipelineContinueToken(ownerId, jobId, secret);
    if (expected.length !== token.length || expected !== token) {
      throw new ByokPipelineError("INVALID_REQUEST", 403);
    }
    const outcome = await executePipelineJob(ownerId, jobId);
    if (outcome === "continue") {
      const { ctx } = await getCloudflareContext({ async: true });
      ctx.waitUntil(schedulePipelineContinue(ownerId, jobId));
    }
    return noStore({ ok: true, jobId, outcome }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
};

export const handlePipelineRetryQuote = async (request: Request, parentJobId: string) => {
  const owner = await requireByokLiveOwner(request, { mutation: true });
  if (owner instanceof NextResponse) return owner;
  try {
    const key = idempotencyKey(request);
    const body = await request.json() as Record<string, unknown>;
    if (Object.keys(body).length !== 0) throw new ByokPipelineError("INVALID_REQUEST", 400);
    const quote = await quotePipelineRetry(owner.ownerId, parentJobId, key);
    return noStore({ quote });
  } catch (error) {
    return errorResponse(error);
  }
};
