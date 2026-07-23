import { NextResponse } from "next/server";

import {
  providerConnectionErrorResponse,
  providerConnectionJson,
  requireProviderConnectionOwner,
} from "@/lib/provider-connections/api";
import { loadProviderCredentialDecryptionKeys } from "@/lib/provider-connections/keyring";
import { verifyManagedProviderConnection } from "@/lib/provider-connections/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

const requestHasBodyBytes = async (request: Request) => {
  if (!request.body) return false;

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    return !Number.isInteger(parsedLength) || parsedLength !== 0;
  }

  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      if (value.byteLength > 0) {
        await reader.cancel();
        return true;
      }
    }
  } catch {
    return true;
  } finally {
    reader.releaseLock();
  }
};

export async function POST(request: Request, context: RouteContext) {
  const owner = await requireProviderConnectionOwner(request, { mutation: true });
  if (owner instanceof NextResponse) return owner;
  if (await requestHasBodyBytes(request)) {
    return providerConnectionJson(
      { error: "Request body is not allowed", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  try {
    const { id } = await context.params;
    const decryptionKeys = await loadProviderCredentialDecryptionKeys();
    const result = await verifyManagedProviderConnection({
      ownerId: owner.ownerId,
      connectionId: id,
      decryptionKeys,
    });
    return providerConnectionJson(result);
  } catch (error) {
    return providerConnectionErrorResponse(error);
  }
}
