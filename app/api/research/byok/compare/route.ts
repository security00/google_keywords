import { NextResponse } from "next/server";

import {
  byokErrorResponse,
  byokJson,
  parseByokCompareBody,
  requireByokLiveOwner,
} from "@/lib/byok/api";
import {
  executeByokCompare,
  executeByokCompareIntentRetry,
  getOwnedByokCompareResult,
  quoteByokCompare,
  quoteByokCompareIntentRetry,
} from "@/lib/byok/compare";
import { loadProviderCredentialDecryptionKeys } from "@/lib/provider-connections/keyring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const owner = await requireByokLiveOwner(request, { mutation: true });
  if (owner instanceof NextResponse) return owner;
  try {
    const input = await parseByokCompareBody(request);
    if (input.action === "quote") {
      return byokJson(await quoteByokCompare({ ownerId: owner.ownerId, ...input }));
    }
    if (input.action === "retry_intent_quote") {
      return byokJson(await quoteByokCompareIntentRetry({ ownerId: owner.ownerId, ...input }));
    }
    const decryptionKeys = await loadProviderCredentialDecryptionKeys();
    const result = input.action === "retry_intent_execute"
      ? await executeByokCompareIntentRetry({ ownerId: owner.ownerId, ...input, decryptionKeys })
      : await executeByokCompare({ ownerId: owner.ownerId, ...input, decryptionKeys });
    return byokJson(result, { status: result.status === "pending" ? 202 : 200 });
  } catch (error) {
    return byokErrorResponse(error);
  }
}

export async function GET(request: Request) {
  const owner = await requireByokLiveOwner(request);
  if (owner instanceof NextResponse) return owner;
  try {
    const jobId = new URL(request.url).searchParams.get("jobId")?.trim();
    if (!jobId) return byokJson({ error: "Missing jobId", code: "INVALID_REQUEST" }, { status: 400 });
    const result = await getOwnedByokCompareResult(owner.ownerId, jobId);
    return byokJson(result, { status: result.status === "pending" ? 202 : 200 });
  } catch (error) {
    return byokErrorResponse(error);
  }
}
