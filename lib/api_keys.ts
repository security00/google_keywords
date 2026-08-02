import { d1Query } from '@/lib/d1';
import { getEffectiveEntitlement } from '@/lib/entitlements';
import { createHash } from 'crypto';

export type ApiKeyScope = 'cache:read' | 'provider:execute' | 'byok:execute';

const DEFAULT_API_KEY_SCOPES: ApiKeyScope[] = ['cache:read'];

function parseApiKeyScopes(value: string | null | undefined): ApiKeyScope[] {
    if (!value) return [...DEFAULT_API_KEY_SCOPES];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) return [...DEFAULT_API_KEY_SCOPES];
        const scopes = parsed.filter(
            (scope): scope is ApiKeyScope =>
                scope === 'cache:read' || scope === 'provider:execute' || scope === 'byok:execute'
        );
        return scopes.length > 0 ? [...new Set(scopes)] : [...DEFAULT_API_KEY_SCOPES];
    } catch {
        return [...DEFAULT_API_KEY_SCOPES];
    }
}

function hashApiKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
}

function legacyKeyPlaceholder(keyHash: string): string {
    return `hash:${keyHash}`;
}

// Persistent rate limiting: max failed attempts per client fingerprint.
const MAX_FAILED_ATTEMPTS = 10;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_RETENTION_MS = 24 * 60 * 60 * 1000;

function getClientFingerprintHash(req: Request): string {
    const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown';
    const ua = req.headers.get('user-agent') || '';
    return createHash('sha256').update(`${ip}:${ua}`).digest('hex');
}

async function getRateLimitState(
    fingerprintHash: string
): Promise<{ blocked: boolean; hasFailureRecord: boolean }> {
    const now = new Date().toISOString();
    const { rows } = await d1Query<{ blocked_until: string | null }>(
        `SELECT blocked_until
         FROM api_key_auth_failures
         WHERE fingerprint_hash = ?
         LIMIT 1`,
        [fingerprintHash]
    );
    return {
        blocked: Boolean(rows[0]?.blocked_until && rows[0].blocked_until > now),
        hasFailureRecord: rows.length > 0,
    };
}

async function recordFailedAttempt(fingerprintHash: string): Promise<void> {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const resetCutoff = new Date(nowMs - FAILURE_WINDOW_MS).toISOString();
    const retentionCutoff = new Date(nowMs - FAILURE_RETENTION_MS).toISOString();
    const blockedUntil = new Date(nowMs + BLOCK_DURATION_MS).toISOString();

    await d1Query(
        `DELETE FROM api_key_auth_failures WHERE updated_at < ?`,
        [retentionCutoff]
    );

    await d1Query(
        `INSERT INTO api_key_auth_failures
         (fingerprint_hash, failed_count, window_started_at, blocked_until, updated_at)
         VALUES (?, 1, ?, NULL, ?)
         ON CONFLICT(fingerprint_hash) DO UPDATE SET
           failed_count = CASE
             WHEN api_key_auth_failures.updated_at < ? THEN 1
             ELSE api_key_auth_failures.failed_count + 1
           END,
           window_started_at = CASE
             WHEN api_key_auth_failures.updated_at < ? THEN ?
             ELSE api_key_auth_failures.window_started_at
           END,
           blocked_until = CASE
             WHEN api_key_auth_failures.updated_at >= ?
              AND api_key_auth_failures.failed_count + 1 >= ?
               THEN ?
             WHEN api_key_auth_failures.blocked_until > ?
               THEN api_key_auth_failures.blocked_until
             ELSE NULL
           END,
           updated_at = ?`,
        [
            fingerprintHash,
            now,
            now,
            resetCutoff,
            resetCutoff,
            now,
            resetCutoff,
            MAX_FAILED_ATTEMPTS,
            blockedUntil,
            now,
            now,
        ]
    );
}

async function clearFailedAttempts(fingerprintHash: string): Promise<void> {
    await d1Query(
        `DELETE FROM api_key_auth_failures WHERE fingerprint_hash = ?`,
        [fingerprintHash]
    );
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
    apiKeyId?: number;
    role?: 'admin' | 'student';
    scopes?: ApiKeyScope[];
    error?: string;
}> {
    const fingerprintHash = req ? getClientFingerprintHash(req) : null;
    let hasFailureRecord = false;

    // Rate limit check
    if (fingerprintHash) {
        const rateLimitState = await getRateLimitState(fingerprintHash);
        if (rateLimitState.blocked) {
            return { valid: false, error: 'Too many failed attempts. Try again later.' };
        }
        hasFailureRecord = rateLimitState.hasFailureRecord;
    }

    // Input validation
    if (!apiKey || typeof apiKey !== 'string') {
        return { valid: false, error: 'API key required' };
    }

    // Reject clearly invalid formats before DB query
    if (apiKey.length > 100 || !API_KEY_PATTERN.test(apiKey)) {
        if (fingerprintHash) await recordFailedAttempt(fingerprintHash);
        return { valid: false, error: 'Invalid API key' };
    }

    try {
        const { rows } = await d1Query<{
            id: number;
            user_id: string;
            expires_at: string | null;
            role: string;
            scopes: string | null;
        }>(
            `SELECT ak.id, ak.user_id, ak.expires_at, ak.scopes, u.role
             FROM api_keys ak
             JOIN auth_users_v2 u ON u.id = ak.user_id
             WHERE ak.key_hash = ? AND ak.active = 1`,
            [hashApiKey(apiKey)]
        );

        const result = rows[0];
        if (!result) {
            if (fingerprintHash) await recordFailedAttempt(fingerprintHash);
            return { valid: false, error: 'Invalid API key' };
        }

        // Check key expiry
        if (result.expires_at && new Date(result.expires_at).getTime() < Date.now()) {
            return { valid: false, error: 'API key expired' };
        }

        if (result.role !== 'admin') {
            const entitlement = await getEffectiveEntitlement(result.user_id);
            if (!entitlement.allowed) {
                return {
                    valid: false,
                    error: entitlement.reason || 'Subscription or activation required.',
                };
            }
        }

        if (fingerprintHash && hasFailureRecord) {
            await clearFailedAttempts(fingerprintHash);
        }

        return {
            valid: true,
            userId: result.user_id,
            apiKeyId: result.id,
            role: result.role === 'admin' ? 'admin' : 'student',
            scopes: parseApiKeyScopes(result.scopes),
        };
    } catch (err) {
        console.error('API key validation error:', err);
        return { valid: false, error: 'Authentication service error' };
    }
}

// Max keys per user to prevent abuse
const MAX_KEYS_PER_USER = 5;

export async function generateApiKey(
    userId: string,
    name: string = 'default',
    scopes: ApiKeyScope[] = DEFAULT_API_KEY_SCOPES
): Promise<string> {
    const entitlement = await getEffectiveEntitlement(userId);
    if (!entitlement.allowed) {
        throw new Error(
            entitlement.reason || '账号尚未开通或订阅已过期，暂时不能生成 API Key。'
        );
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

    const keyHash = hashApiKey(key);
    const normalizedScopes = parseApiKeyScopes(JSON.stringify(scopes));

    await d1Query(
        `INSERT INTO api_keys
         (key, key_hash, key_prefix, key_last4, user_id, name, scopes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            legacyKeyPlaceholder(keyHash),
            keyHash,
            key.slice(0, 12),
            key.slice(-4),
            userId,
            safeName,
            JSON.stringify(normalizedScopes),
        ]
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
    scopes: ApiKeyScope[];
}>> {
    const { rows } = await d1Query<{
        id: number;
        key_prefix: string | null;
        key_last4: string | null;
        name: string;
        created_at: string;
        expires_at: string | null;
        active: number;
        scopes: string | null;
    }>(
        `SELECT id, key_prefix, key_last4, name, created_at, expires_at, active, scopes
         FROM api_keys
         WHERE user_id = ?
         ORDER BY created_at DESC`,
        [userId]
    );

    return rows.map(k => ({
        id: k.id,
        key: `${k.key_prefix ?? 'gk_live_****'}...${k.key_last4 ?? '****'}`,
        name: k.name,
        created_at: k.created_at,
        expires_at: k.expires_at,
        active: k.active,
        scopes: parseApiKeyScopes(k.scopes),
    }));
}

export async function revokeApiKey(userId: string, keyId: number): Promise<boolean> {
    const { meta } = await d1Query(
        `UPDATE api_keys SET active = 0 WHERE id = ? AND user_id = ?`,
        [keyId, userId]
    );
    return (meta?.changes ?? 0) > 0;
}
