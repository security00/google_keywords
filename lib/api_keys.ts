import { D1Database } from '@cloudflare/workers-types';

interface D1Result<T = unknown> {
    results: T[];
    success: boolean;
    meta?: unknown;
}

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
    // Use IP + User-Agent as fingerprint for rate limiting
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
        return false;
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
    d1: D1Database,
    apiKey: string,
    req?: Request
): Promise<{
    valid: boolean;
    userId?: number;
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
        const result = await d1.prepare(
            `SELECT ak.user_id, ak.expires_at, u.trial_expires_at, u.role
             FROM api_keys ak
             JOIN auth_users u ON u.id = ak.user_id
             WHERE ak.key = ? AND ak.active = 1`
        ).bind(apiKey).first() as {
            user_id: number;
            expires_at: string | null;
            trial_expires_at: string | null;
            role: string;
        } | null;

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

export async function generateApiKey(d1: D1Database, userId: number, name: string = 'default'): Promise<string> {
    // Check key limit
    const existing = await d1.prepare(
        `SELECT COUNT(*) as cnt FROM api_keys WHERE user_id = ? AND active = 1`
    ).bind(userId).first() as { cnt: number } | null;

    if (existing && existing.cnt >= MAX_KEYS_PER_USER) {
        throw new Error(`Maximum ${MAX_KEYS_PER_USER} active API keys allowed. Delete an existing key first.`);
    }

    // Sanitize name
    const safeName = String(name).slice(0, 50).replace(/[<>"'&]/g, '');

    // Generate key: gk_live_ + 32 random hex chars (128 bits of entropy)
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const key = 'gk_live_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

    await d1.prepare(
        `INSERT INTO api_keys (key, user_id, name) VALUES (?, ?, ?)`
    ).bind(key, userId, safeName).run();

    return key;
}

export async function listApiKeys(d1: D1Database, userId: number): Promise<Array<{
    id: number;
    key: string;
    name: string;
    created_at: string;
    expires_at: string | null;
    active: number;
}>> {
    const result = await d1.prepare(
        `SELECT id, key, name, created_at, expires_at, active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`
    ).bind(userId).all();

    // Always mask keys in list — never return full key
    const rows = (result as D1Result).results as Array<{
        id: number;
        key: string;
        name: string;
        created_at: string;
        expires_at: string | null;
        active: number;
    }>;

    return rows.map(k => ({
        ...k,
        key: k.key.slice(0, 12) + '...' + k.key.slice(-4),
    }));
}

export async function revokeApiKey(d1: D1Database, userId: number, keyId: number): Promise<boolean> {
    const result = await d1.prepare(
        `UPDATE api_keys SET active = 0 WHERE id = ? AND user_id = ?`
    ).bind(keyId, userId).run();
    return (result as any).meta?.changes > 0;
}
