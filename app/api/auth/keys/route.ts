import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { generateApiKey, listApiKeys, revokeApiKey, type ApiKeyScope } from '@/lib/api_keys';
import { getEffectiveEntitlement } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';

// GET /api/auth/keys — list current user's API keys (masked)
export async function GET() {
    const user = await getAuthUser();
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const keys = await listApiKeys(String(user.id));
    return NextResponse.json({ keys });
}

// POST /api/auth/keys — generate new API key
export async function POST(req: NextRequest) {
    const user = await getAuthUser();
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const entitlement = await getEffectiveEntitlement(String(user.id));
    if (!entitlement.allowed) {
        return NextResponse.json(
            { error: entitlement.reason || 'Activation or subscription required.', code: 'entitlement_required' },
            { status: 403 }
        );
    }

    let body: { name?: string; scopes?: ApiKeyScope[] } = {};
    try {
        body = await req.json();
    } catch {
        // empty body is fine
    }

    const name = String(body.name || 'default').slice(0, 50);

    try {
        const requested: ApiKeyScope[] = Array.isArray(body.scopes) ? body.scopes : ['cache:read'];
        if (requested.some((scope) => scope !== 'cache:read' && scope !== 'byok:execute')) {
            return NextResponse.json({ error: 'Unsupported API key scope' }, { status: 400 });
        }
        const scopes = [...new Set<ApiKeyScope>(['cache:read' as const, ...requested])];
        const key = await generateApiKey(String(user.id), name, scopes);
        return NextResponse.json({
            key,
            scopes,
            message: 'Save this key securely. It will not be shown again.',
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to generate key';
        return NextResponse.json(
            { error: message },
            { status: 400 }
        );
    }
}

// DELETE /api/auth/keys — revoke an API key
export async function DELETE(req: NextRequest) {
    const user = await getAuthUser();
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: { keyId?: number } = {};
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    if (!body.keyId || typeof body.keyId !== 'number') {
        return NextResponse.json({ error: 'keyId required' }, { status: 400 });
    }

    const revoked = await revokeApiKey(String(user.id), body.keyId);
    if (!revoked) {
        return NextResponse.json({ error: 'Key not found or not yours' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
}
