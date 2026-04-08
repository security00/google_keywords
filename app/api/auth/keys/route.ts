import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { generateApiKey, listApiKeys, revokeApiKey } from '@/lib/api_keys';

export const dynamic = 'force-dynamic';

// GET /api/auth/keys — list current user's API keys (masked)
export async function GET(_req: NextRequest) {
    const user = await getAuthUser();
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const keys = await listApiKeys(Number(user.id));
    return NextResponse.json({ keys });
}

// POST /api/auth/keys — generate new API key
export async function POST(req: NextRequest) {
    const user = await getAuthUser();
    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: { name?: string } = {};
    try {
        body = await req.json();
    } catch {
        // empty body is fine
    }

    const name = String(body.name || 'default').slice(0, 50);

    try {
        const key = await generateApiKey(Number(user.id), name);
        return NextResponse.json({
            key,
            message: 'Save this key securely. It will not be shown again.',
        });
    } catch (err: any) {
        return NextResponse.json(
            { error: err.message || 'Failed to generate key' },
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

    const revoked = await revokeApiKey(Number(user.id), body.keyId);
    if (!revoked) {
        return NextResponse.json({ error: 'Key not found or not yours' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
}
