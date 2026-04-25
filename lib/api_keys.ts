import { d1Query } from '@/lib/d1';
import { createHash } from 'crypto';

function hashApiKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
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
// Standard keys: gk_live_ + 32 hex (40 chars)
// Admin/internal keys: gk_live_ + 32+ hex (longer, used by precompute etc)
const API_KEY_PATTERN = /^gk_live_[0-9a-f]{32,64}$/;

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
             WHERE ak.key_hash = ? AND ak.active = 1`,
            [hashApiKey(apiKey)]
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

        // Students must have an active trial window before an API key can be used.
        if (result.role !== 'admin' && !result.trial_expires_at) {
            return { valid: false, error: 'Account not activated yet. Please contact your administrator.' };
        }

        // Check trial expiry (unless admin)
        if (
            result.role !== 'admin' &&
            result.trial_expires_at &&
            new Date(result.trial_expires_at).getTime() < Date.now()
        ) {
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
    const { rows: users } = await d1Query<{ role: string; trial_expires_at: string | null }>(
        `SELECT role, trial_expires_at FROM auth_users_v2 WHERE id = ? LIMIT 1`,
        [userId]
    );
    const user = users[0];
    if (!user) {
        throw new Error('User not found.');
    }
    if (user.role !== 'admin' && !user.trial_expires_at) {
        throw new Error('账号尚未开通，暂时不能生成 API Key。');
    }
    if (
        user.role !== 'admin' &&
        user.trial_expires_at &&
        new Date(user.trial_expires_at).getTime() < Date.now()
    ) {
        throw new Error('试用期已过期，暂时不能生成 API Key。');
    }

    // Check key limit
    const { rows } = await d1Query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM api_keys WHERE user_id = ? AND active = 1`,
        [userId]
    );

    if (rows[0] && rows[0].cnt >= MAX_KEYS_PER_USER) {
        throw new Error(`Maximum ${MAX_KEYS_PER_USER} active API keys allowed. Delete an existing key first.`);
    }

    // Sanitize name
    const safeName = String(name).slice(0, 50).replace(/[<>"'&]/g, '').trim() || 'default';

    const { rows: nameRows } = await d1Query<{ id: number }>(
        `SELECT id FROM api_keys WHERE user_id = ? AND active = 1 AND lower(name) = lower(?) LIMIT 1`,
        [userId, safeName]
    );
    if (nameRows[0]) {
        throw new Error('已存在同名的有效 API Key，请换一个名称。');
    }

    // Generate key: gk_live_ + 32 random hex chars (128 bits of entropy)
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const key = 'gk_live_' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');

    await d1Query(
        `INSERT INTO api_keys (key, key_hash, key_prefix, key_last4, user_id, name) VALUES (?, ?, ?, ?, ?, ?)`,
        [key, hashApiKey(key), key.slice(0, 12), key.slice(-4), userId, safeName]
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
        key_prefix: string | null;
        key_last4: string | null;
        name: string;
        created_at: string;
        expires_at: string | null;
        active: number;
    }>(
        `SELECT id, key_prefix, key_last4, name, created_at, expires_at, active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
        [userId]
    );

    return rows.map(k => ({
        id: k.id,
        key: `${k.key_prefix ?? 'gk_live_****'}...${k.key_last4 ?? '****'}`,
        name: k.name,
        created_at: k.created_at,
        expires_at: k.expires_at,
        active: k.active,
    }));
}

export async function revokeApiKey(userId: string, keyId: number): Promise<boolean> {
    const { meta } = await d1Query(
        `UPDATE api_keys SET active = 0 WHERE id = ? AND user_id = ?`,
        [keyId, userId]
    );
    return (meta?.changes ?? 0) > 0;
}
