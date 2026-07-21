import { NextResponse } from "next/server";

import {
  parseRotateProviderConnectionBody,
  providerConnectionErrorResponse,
  providerConnectionJson,
  readLimitedJsonObject,
  requireProviderConnectionOwner,
} from "@/lib/provider-connections/api";
import { loadActiveProviderCredentialEncryptionKeys } from "@/lib/provider-connections/keyring";
import {
  removeProviderConnection,
  rotateDataForSeoConnection,
  rotateOpenRouterConnection,
} from "@/lib/provider-connections/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = Readonly<{ params: Promise<{ id: string }> }>;

export async function PUT(request: Request, context: RouteContext) {
  const owner = await requireProviderConnectionOwner(request, { mutation: true });
  if (owner instanceof NextResponse) return owner;

  try {
    const { id } = await context.params;
    const body = parseRotateProviderConnectionBody(
      await readLimitedJsonObject(request),
    );
    const keys = await loadActiveProviderCredentialEncryptionKeys();
    const connection = body.provider === "openrouter"
      ? await rotateOpenRouterConnection({
        ownerId: owner.ownerId,
        connectionId: id,
        expectedCredentialVersion: body.expectedCredentialVersion,
        label: body.label,
        apiKey: body.apiKey,
        keys,
      })
      : await rotateDataForSeoConnection({
        ownerId: owner.ownerId,
        connectionId: id,
        expectedCredentialVersion: body.expectedCredentialVersion,
        label: body.label,
        login: body.login,
        password: body.password,
        keys,
      });
    return providerConnectionJson({ connection });
  } catch (error) {
    return providerConnectionErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const owner = await requireProviderConnectionOwner(request, { mutation: true });
  if (owner instanceof NextResponse) return owner;

  try {
    const { id } = await context.params;
    await removeProviderConnection(owner.ownerId, id);
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return providerConnectionErrorResponse(error);
  }
}
