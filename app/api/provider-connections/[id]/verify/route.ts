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

export async function POST(request: Request, context: RouteContext) {
  const owner = await requireProviderConnectionOwner(request, { mutation: true });
  if (owner instanceof NextResponse) return owner;
  if (request.body) {
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
