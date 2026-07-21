import { NextResponse } from "next/server";

import {
  getByokSpendControlPolicy,
  getByokSpendControls,
  updateByokSpendControls,
} from "@/lib/byok/spend-controls";
import {
  byokSpendErrorResponse,
  parseUpdateByokSpendControlsBody,
} from "@/lib/byok/spend-api";
import {
  providerConnectionJson,
  readLimitedJsonObject,
  requireProviderConnectionOwner,
} from "@/lib/provider-connections/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const owner = await requireProviderConnectionOwner(request);
  if (owner instanceof NextResponse) return owner;
  try {
    return providerConnectionJson({
      controls: await getByokSpendControls(owner.ownerId),
      policy: getByokSpendControlPolicy(),
    });
  } catch (error) {
    return byokSpendErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const owner = await requireProviderConnectionOwner(request, { mutation: true });
  if (owner instanceof NextResponse) return owner;
  try {
    const body = parseUpdateByokSpendControlsBody(
      await readLimitedJsonObject(request),
    );
    return providerConnectionJson({
      controls: await updateByokSpendControls({ ownerId: owner.ownerId, ...body }),
      policy: getByokSpendControlPolicy(),
    });
  } catch (error) {
    return byokSpendErrorResponse(error);
  }
}
