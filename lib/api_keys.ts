import { d1Query } from '@/lib/d1';

// Rate limiting: max failed attempts per key prefix before temporary block
const MAX_FAILED_ATTEMPTS = 10;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const failedAttempts = new Map<string, { count: number; blockedUntil: number }>();

// Purge expired entries every 100 lookups
let purgeCounter = 0;
function purgeExpired() {
    purgeCounter++;
    if (purgeCounter % 100 === 0) {
        const now = Date.now();
        for (const [k, v] of failedAttempts) {
            if (v.blockedUntil < now) failedAttempts.delete(k);
        }
    }
}

function getClientFingerprint(req: Request): string {
    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown';
    const ua = req.headers.get('user-agent') || '';
    return `${ip}:${ua}`.slice(0, 128);
}

function isRateBlocked(fingerprint: string): boolean {
    const entry = failedAttempts.get(fingerprint);
    if (!entry) return false;
    if (entry.blockedUntil && entry.blockedUntil > Date.now()) return true;
    if (entry.blockedUntil && entry.blockedUntil <= Date.now()) {
        failedAttempts.delete(fingerprint);
    }
    return false;
}

function recordFailedAttempt(fingerprint: string) {
    const entry = failedAttempts.get(fingerprint) || { count: 0, blockedUntil: 0 };
    entry.count++;
    if (entry.count >= MAX_FAILED_ATTEMPTS) {
        entry.blockedUntil = Date.now() + BLOCK_DURATION_MS;
    }
    failedAttempts.set(fingerprint, entry);
}

// Validate API key format before hitting DB
const API_KEY_PATTERN = /^gk_live_[0-9a-f]{32}$/;

export async function validateApiKey(
    apiKey: string,
    req?: Request
): Promise<{
    valid: boolean;
    userId?: string;
    error?: string;
}> {
    purgeExpired();

    // Rate limit check
    if (req) {
        const fp = getClientFingerprint(req);
        if (isRateBlocked(fp)) {
            return { valid: false, error: 'Too many failed attempts. Try again later.' };
        }
    }

    // Input validation
    if (!apiKey || typeof apiKey !== 'string') {
        return { valid: false, error: 'API key required' };
    }

    // Reject clearly invalid formats before DB query
    if (apiKey.length > 100 || !API_KEY_PATTERN.test(apiKey)) {
        if (req) recordFailedAttempt(getClientFingerprint(req));
        return { valid: false, error: 'Invalid API key' };
    }

    try {
        const { rows } = await d1Query<{
            user_id: string;
            expires_at: string | null;
            trial_expires_at: string | null;
            role: string;
        }>(
            `SELECT ak.user_id, ak.expires_at, u.trial_expires_at, u.role
             FROM api_keys ak
             JOIN auth_users_v2 u ON u.id = ak.user_id
             WHERE ak.key = ? AND ak.active = 1`,
            [apiKey]
        );

        const result = rows[0];
        if (!result) {
            if (req) recordFailedAttempt(getClientFingerprint(req));
            return { valid: false, error: 'Invalid API key' };
        }

        // Check key expiry
        if (result.expires_at && new Date(result.expires_at).getTime() < Date.now()) {
            return { valid: false, error: 'API key expired' };
        }

        // Check trial expiry (unless admin)
        if (result.role !== 'admin' && result.trial_expires_at && new Date(result.trial_expires_at).getTime() < Date.now()) {
            return { valid: false, error: 'Trial expired. Please upgrade your plan.' };
        }

        return { valid: true, userId: result.user_id };
    } catch (err) {
        console.error('API key validation error:', err);
        return { valid: false, error: 'Authentication service error' };
    }
}

// Max keys per user to prevent abuse
const MAX_KEYS_PER_USER = 5;

export async function generateApiKey(userId: string, name: string = 'default'): Promise<string> {
    // Check key limit
    const { rows } = await d1Query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM api_keys WHERE user_id = ? AND active = 1`,
        [userId]
    );

    if (rows[0] && rows[0].cnt >= MAX_KEYS_PER_USER) {
        throw new Error(`Maximum ${MAX_KEYS_PER_USER} active API keys allowed. Delete an existing key first.`);
    }

    // Sanitize name
    const safeName = String(name).slice(0, 50).replace(/[<>"'&]/g, '');

    // Generate key: gk_live_ + 32 random hex chars (128 bits of entropy)
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const key = 'gk_live_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

    await d1Query(
        `INSERT INTO api_keys (key, user_id, name) VALUES (?, ?, ?)`,
        [key, userId, safeName]
    );

    return key;
}

export async function listApiKeys(userId: string): Promise<Array<{
    id: number;
    key: string;
    name: string;
    created_at: string;
    expires_at: string | null;
    active: number;
}>> {
    const { rows } = await d1Query<{
        id: number;
        key: string;
        name: string;
        created_at: string;
        expires_at: string | null;
        active: number;
    }>(
        `SELECT id, key, name, created_at, expires_at, active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
        [userId]
    );

    // Always mask keys — never return full key in list
    return rows.map(k => ({
        ...k,
        key: k.key.slice(0, 12) + '...' + k.key.slice(-4),
    }));
}

export async function revokeApiKey(userId: string, keyId: number): Promise<boolean> {
    const { meta } = await d1Query(
        `UPDATE api_keys SET active = 0 WHERE id = ? AND user_id = ?`,
        [keyId, userId]
    );
    return (meta?.changes ?? 0) > 0;
}
