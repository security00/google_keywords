import { NextResponse } from "next/server";

import {
  parseCreateProviderConnectionBody,
  providerConnectionErrorResponse,
  providerConnectionJson,
  readLimitedJsonObject,
  requireProviderConnectionOwner,
} from "@/lib/provider-connections/api";
import { loadActiveProviderCredentialEncryptionKeys } from "@/lib/provider-connections/keyring";
import {
  createOpenRouterConnection,
  listOpenRouterConnections,
} from "@/lib/provider-connections/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const owner = await requireProviderConnectionOwner(request);
  if (owner instanceof NextResponse) return owner;

  try {
    const connections = await listOpenRouterConnections(owner.ownerId);
    return providerConnectionJson({ connections });
  } catch (error) {
    return providerConnectionErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const owner = await requireProviderConnectionOwner(request, { mutation: true });
  if (owner instanceof NextResponse) return owner;

  try {
    const body = parseCreateProviderConnectionBody(
      await readLimitedJsonObject(request),
    );
    const keys = await loadActiveProviderCredentialEncryptionKeys();
    const connection = await createOpenRouterConnection({
      ownerId: owner.ownerId,
      label: body.label,
      apiKey: body.apiKey,
      keys,
    });
    return providerConnectionJson({ connection });
  } catch (error) {
    return providerConnectionErrorResponse(error);
  }
}
