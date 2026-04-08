import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { validateApiKey } from '@/lib/api_keys';

/**
 * Unified auth: accepts either session cookie or API key.
 * API key via: Authorization: Bearer gk_live_xxx
 *             or: ?api_key=gk_live_xxx (less secure, only for testing)
 */
export async function authenticate(req: NextRequest): Promise<{
    authenticated: boolean;
    userId?: string;
    error?: string;
}> {
    // 1. Try API key from Authorization header (preferred)
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
        const apiKey = authHeader.slice(7).trim();
        const result = await validateApiKey(apiKey, req);
        if (result.valid) {
            return { authenticated: true, userId: String(result.userId) };
        }
        return { authenticated: false, error: result.error };
    }

    // 2. Try API key from query param (only over HTTPS)
    const apiKeyParam = req.nextUrl.searchParams.get('api_key');
    if (apiKeyParam) {
        if (req.nextUrl.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
            return { authenticated: false, error: 'API key in URL requires HTTPS' };
        }
        const result = await validateApiKey(apiKeyParam, req);
        if (result.valid) {
            return { authenticated: true, userId: String(result.userId) };
        }
        return { authenticated: false, error: result.error };
    }

    // 3. Try session cookie (web UI)
    const user = await getAuthUser();
    if (user) {
        return { authenticated: true, userId: user.id };
    }

    return { authenticated: false, error: 'Authentication required. Use API key or login.' };
}
