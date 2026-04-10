import "server-only";

import { d1Query } from "@/lib/d1";

// ============================================
// 学员系统：试用期 + 用量配额
// ============================================

const TRIAL_DAYS = 90; // 3个月
const DAILY_API_LIMIT = 3; // 每人每天最多 3 次 API 调用（1 次扩展 + 1 次对比 + 1 次冗余）

export type UserRole = "admin" | "student";

export interface UserWithMeta {
  id: string;
  email: string;
  role: UserRole;
  trialStartedAt: string | null;
  trialExpiresAt: string | null;
}

interface UserV2Row {
  id: string;
  email: string;
  role: string;
  trial_started_at: string | null;
  trial_expires_at: string | null;
}

interface UsageRow {
  api_calls: number;
}

interface InviteCodeRow {
  code: string;
  used_by: string | null;
  max_uses: number;
  current_uses: number;
  expires_at: string | null;
}

// -------------------------------------------
// 用户查询（v2 表）
// -------------------------------------------
export async function getUserWithMeta(userId: string): Promise<UserWithMeta | null> {
  const { rows } = await d1Query<UserV2Row>(
    `SELECT id, email, role, trial_started_at, trial_expires_at
     FROM auth_users_v2 WHERE id = ? LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    email: r.email,
    role: (r.role as UserRole) || "student",
    trialStartedAt: r.trial_started_at,
    trialExpiresAt: r.trial_expires_at,
  };
}

// -------------------------------------------
// 试用期检查
// -------------------------------------------
export function isTrialActive(user: UserWithMeta): { active: boolean; expiresAt: string | null; daysLeft: number } {
  // admin 永不过期
  if (user.role === "admin") {
    return { active: true, expiresAt: null, daysLeft: Infinity };
  }

  if (!user.trialExpiresAt) {
    return { active: false, expiresAt: null, daysLeft: 0 };
  }

  const expires = new Date(user.trialExpiresAt).getTime();
  const now = Date.now();
  const daysLeft = Math.max(0, Math.ceil((expires - now) / (1000 * 60 * 60 * 24)));

  return {
    active: expires > now,
    expiresAt: user.trialExpiresAt,
    daysLeft,
  };
}

// -------------------------------------------
// 每日用量检查 & 计数
// -------------------------------------------
function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getDailyUsage(userId: string): Promise<number> {
  const today = getTodayStr();
  const { rows } = await d1Query<UsageRow>(
    `SELECT api_calls FROM daily_api_usage WHERE user_id = ? AND date = ? LIMIT 1`,
    [userId, today]
  );
  return rows[0]?.api_calls || 0;
}

export async function incrementDailyUsage(userId: string): Promise<number> {
  const today = getTodayStr();
  // 先查
  const current = await getDailyUsage(userId);
  if (current === 0) {
    await d1Query(
      `INSERT INTO daily_api_usage (user_id, date, api_calls) VALUES (?, ?, 1)`,
      [userId, today]
    );
    return 1;
  } else {
    const newCount = current + 1;
    await d1Query(
      `UPDATE daily_api_usage SET api_calls = ? WHERE user_id = ? AND date = ?`,
      [newCount, userId, today]
    );
    return newCount;
  }
}

export async function checkApiQuota(userId: string): Promise<{ allowed: boolean; used: number; limit: number }> {
  const user = await getUserWithMeta(userId);
  if (!user) return { allowed: false, used: 0, limit: 0 };

  // admin 不限制
  if (user.role === "admin") {
    return { allowed: true, used: 0, limit: Infinity };
  }

  const used = await getDailyUsage(userId);
  return {
    allowed: used < DAILY_API_LIMIT,
    used,
    limit: DAILY_API_LIMIT,
  };
}

// -------------------------------------------
// 综合检查（一次性检查 trial + quota）
// -------------------------------------------
export type AccessCheckResult =
  | { allowed: true; user: UserWithMeta; quota: { used: number; limit: number }; trial: { active: boolean; daysLeft: number; expiresAt: string | null } }
  | { allowed: false; reason: string; code: "unauthorized" | "trial_expired" | "quota_exceeded" };

export async function checkStudentAccess(userId: string): Promise<AccessCheckResult> {
  const user = await getUserWithMeta(userId);
  if (!user) {
    return { allowed: false, reason: "用户不存在", code: "unauthorized" };
  }

  // 管理员豁免所有检查
  if (user.role === "admin") {
    return {
      allowed: true,
      user,
      quota: { used: 0, limit: 999999 },
      trial: { active: true, daysLeft: 9999, expiresAt: null },
    };
  }

  // 试用期检查
  const trial = isTrialActive(user);
  if (!trial.active) {
    return { allowed: false, reason: `试用期已过期${trial.expiresAt ? "（到期日：" + trial.expiresAt.slice(0, 10) + "）" : ""}，请联系管理员续费`, code: "trial_expired" };
  }

  // 用量检查
  const quota = await checkApiQuota(userId);
  if (!quota.allowed) {
    return { allowed: false, reason: `今日 API 调用已达上限（${quota.used}/${quota.limit}），明天再来`, code: "quota_exceeded" };
  }

  return { allowed: true, user, quota, trial };
}

// -------------------------------------------
// 邀请码
// -------------------------------------------
export async function validateInviteCode(code: string): Promise<{ valid: boolean; error?: string }> {
  if (!code || code.trim().length < 4) {
    return { valid: false, error: "邀请码格式不正确" };
  }

  const { rows } = await d1Query<InviteCodeRow>(
    `SELECT code, used_by, max_uses, current_uses, expires_at FROM invite_codes WHERE code = ? LIMIT 1`,
    [code.trim()]
  );

  if (!rows.length) {
    return { valid: false, error: "邀请码不存在" };
  }

  const inv = rows[0];

  // 检查过期
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    return { valid: false, error: "邀请码已过期" };
  }

  // 检查使用次数
  if (inv.current_uses >= inv.max_uses) {
    return { valid: false, error: "邀请码已用完" };
  }

  return { valid: true };
}

export async function consumeInviteCode(code: string, userId: string): Promise<void> {
  await d1Query(
    `UPDATE invite_codes SET current_uses = current_uses + 1, used_by = ? WHERE code = ?`,
    [userId, code.trim()]
  );
}

export async function generateInviteCodes(
  createdBy: string,
  count: number = 1,
  maxUsesPerCode: number = 1,
  expiresAt?: string
): Promise<string[]> {
  // Input bounds
  if (count < 1 || count > 100) throw new Error('count must be 1-100');
  if (maxUsesPerCode < 1 || maxUsesPerCode > 1000) throw new Error('maxUsesPerCode must be 1-1000');

  const codes: string[] = [];
  // 生成格式：SK-XXXX-XXXX（SK = Student Key）
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉容易混淆的 I/O/0/1

  // Use crypto.getRandomValues for secure randomness
  const randomBytes = new Uint8Array(count * 8);
  crypto.getRandomValues(randomBytes);
  let byteIdx = 0;

  for (let i = 0; i < count; i++) {
    let code = "SK-";
    for (let j = 0; j < 4; j++) code += chars[randomBytes[byteIdx++] % chars.length];
    code += "-";
    for (let j = 0; j < 4; j++) code += chars[randomBytes[byteIdx++] % chars.length];

    await d1Query(
      `INSERT INTO invite_codes (code, created_by, max_uses, current_uses, expires_at, created_at) VALUES (?, ?, ?, 0, ?, datetime('now'))`,
      [code, createdBy, maxUsesPerCode, expiresAt || null]
    );
    codes.push(code);
  }

  return codes;
}
