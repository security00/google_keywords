import { d1Query } from "@/lib/d1";
import { getAuthUser } from "@/lib/auth";

// ── Types ──

export type AdminUser = {
  id: string;
  email: string;
  role: string;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  created_at: string;
};

export type AdminUserDetail = AdminUser & {
  api_keys: { id: number; name: string; key: string; active: number; created_at: string }[];
  invite_codes: { code: string; max_uses: number; current_uses: number }[];
  daily_usage: { date: string; api_calls: number }[];
};

export type InviteCodeWithUser = {
  code: string;
  created_by: string;
  used_by: string | null;
  max_uses: number;
  current_uses: number;
  expires_at: string | null;
  created_at: string;
  user_email?: string;
  status: "available" | "used" | "expired" | "exhausted";
};

// ── Admin check ──

export async function requireAdmin(): Promise<{ userId: string; error?: string }> {
  const user = await getAuthUser();
  if (!user) return { userId: "", error: "Unauthorized" };
  if (user.role !== "admin") return { userId: "", error: "Forbidden: admin only" };
  return { userId: user.id };
}

// ── Invite codes ──

export async function listInviteCodes(): Promise<InviteCodeWithUser[]> {
  const { rows } = await d1Query<InviteCodeWithUser>(
    `SELECT ic.code, ic.created_by, ic.used_by, ic.max_uses, ic.current_uses,
            ic.expires_at, ic.created_at, u.email as user_email
     FROM invite_codes ic
     LEFT JOIN auth_users_v2 u ON ic.used_by = u.id
     ORDER BY ic.created_at DESC`
  );

  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    status: r.expires_at && new Date(r.expires_at).getTime() < now
      ? "expired"
      : r.current_uses >= r.max_uses
        ? "exhausted"
        : r.current_uses > 0
          ? "used"
          : "available",
  }));
}

export async function deleteInviteCode(code: string): Promise<void> {
  await d1Query(`DELETE FROM invite_codes WHERE code = ?`, [code]);
}

// ── Users ──

export async function listUsers(
  page = 1,
  pageSize = 20,
  search = ""
): Promise<{ users: AdminUser[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const offset = (safePage - 1) * safePageSize;
  const normalizedSearch = search.trim().toLowerCase();
  const whereClause = normalizedSearch ? `WHERE lower(email) LIKE ?` : "";
  const searchParams = normalizedSearch ? [`%${normalizedSearch}%`] : [];

  const countResult = await d1Query<{ total: number }>(
    `SELECT COUNT(*) as total FROM auth_users_v2 ${whereClause}`,
    searchParams
  );
  const total = countResult.rows[0]?.total ?? 0;

  const { rows: users } = await d1Query<AdminUser>(
    `SELECT id, email, role, trial_started_at, trial_expires_at, created_at
     FROM auth_users_v2 ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...searchParams, safePageSize, offset]
  );

  return {
    users,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function listPendingUsers(
  page = 1,
  pageSize = 20,
  search = ""
): Promise<{ users: AdminUser[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const offset = (safePage - 1) * safePageSize;
  const normalizedSearch = search.trim().toLowerCase();
  const searchClause = normalizedSearch ? ` AND lower(email) LIKE ?` : "";
  const searchParams = normalizedSearch ? [`%${normalizedSearch}%`] : [];

  const countResult = await d1Query<{ total: number }>(
    `SELECT COUNT(*) as total FROM auth_users_v2 WHERE role = 'student' AND trial_expires_at IS NULL${searchClause}`,
    searchParams
  );
  const total = countResult.rows[0]?.total ?? 0;

  const { rows: users } = await d1Query<AdminUser>(
    `SELECT id, email, role, trial_started_at, trial_expires_at, created_at
     FROM auth_users_v2 WHERE role = 'student' AND trial_expires_at IS NULL${searchClause}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...searchParams, safePageSize, offset]
  );

  return {
    users,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function listActiveUsers(
  page = 1,
  pageSize = 20,
  search = ""
): Promise<{ users: AdminUser[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(100, Math.max(1, pageSize));
  const offset = (safePage - 1) * safePageSize;
  const normalizedSearch = search.trim().toLowerCase();
  const searchClause = normalizedSearch ? ` AND lower(email) LIKE ?` : "";
  const searchParams = normalizedSearch ? [`%${normalizedSearch}%`] : [];

  const countResult = await d1Query<{ total: number }>(
    `SELECT COUNT(*) as total FROM auth_users_v2 WHERE role = 'student' AND trial_expires_at IS NOT NULL${searchClause}`,
    searchParams
  );
  const total = countResult.rows[0]?.total ?? 0;

  const { rows: users } = await d1Query<AdminUser>(
    `SELECT id, email, role, trial_started_at, trial_expires_at, created_at
     FROM auth_users_v2 WHERE role = 'student' AND trial_expires_at IS NOT NULL${searchClause}
     ORDER BY trial_expires_at DESC, created_at DESC LIMIT ? OFFSET ?`,
    [...searchParams, safePageSize, offset]
  );

  return {
    users,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.max(1, Math.ceil(total / safePageSize)),
  };
}

export async function listAllUsers(): Promise<AdminUser[]> {
  const { rows } = await d1Query<AdminUser>(
    `SELECT id, email, role, trial_started_at, trial_expires_at, created_at
     FROM auth_users_v2 ORDER BY created_at DESC`
  );
  return rows;
}

export async function activateUserTrials(
  userIds: string[],
  trialDays = 90
): Promise<{ updated: number }> {
  const uniqueUserIds = Array.from(new Set(userIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueUserIds.length === 0) {
    return { updated: 0 };
  }

  const now = new Date();
  const trialStartedAt = now.toISOString();
  const trialExpiresAt = new Date(
    now.getTime() + trialDays * 24 * 60 * 60 * 1000
  ).toISOString();
  let updated = 0;

  for (let index = 0; index < uniqueUserIds.length; index += 100) {
    const chunk = uniqueUserIds.slice(index, index + 100);
    const placeholders = chunk.map(() => "?").join(", ");
    const params = [
      trialStartedAt,
      trialExpiresAt,
      now.toISOString(),
      ...chunk,
    ];
    const result = await d1Query(
      `UPDATE auth_users_v2
       SET trial_started_at = ?, trial_expires_at = ?, updated_at = ?
       WHERE role = 'student' AND id IN (${placeholders})`,
      params
    );
    updated += result.meta?.changes ?? 0;
  }

  return { updated };
}

export async function getUserDetail(id: string): Promise<AdminUserDetail | null> {
  const { rows } = await d1Query<AdminUser>(
    `SELECT id, email, role, trial_started_at, trial_expires_at, created_at
     FROM auth_users_v2 WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;

  const user: AdminUser = {
    id: rows[0].id,
    email: rows[0].email,
    role: rows[0].role,
    trial_started_at: rows[0].trial_started_at,
    trial_expires_at: rows[0].trial_expires_at,
    created_at: rows[0].created_at,
  };

  const [keys, codes, usage] = await Promise.all([
    d1Query<Record<string, unknown>>(
      `SELECT id, name, key, created_at, active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
      [id]
    ),
    d1Query<Record<string, unknown>>(
      `SELECT code, max_uses, current_uses FROM invite_codes WHERE used_by = ?`,
      [id]
    ),
    d1Query<Record<string, unknown>>(
      `SELECT date, api_calls FROM daily_api_usage WHERE user_id = ? ORDER BY date DESC LIMIT 30`,
      [id]
    ),
  ]);

  return {
    ...user,
    api_keys: keys.rows as AdminUserDetail["api_keys"],
    invite_codes: codes.rows as AdminUserDetail["invite_codes"],
    daily_usage: usage.rows as AdminUserDetail["daily_usage"],
  };
}

export async function updateUserRole(operatorId: string, targetId: string, role: string): Promise<{ error?: string }> {
  // Cannot modify yourself
  if (operatorId === targetId) {
    return { error: "Cannot modify your own role" };
  }

  // Check remaining admins if demoting an admin
  if (role !== "admin") {
    const { rows } = await d1Query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM auth_users_v2 WHERE role = 'admin' AND id != ?`,
      [targetId]
    );
    if (!rows.length || rows[0].cnt === 0) {
      return { error: "Cannot remove the last admin" };
    }
  }

  await d1Query(`UPDATE auth_users_v2 SET role = ? WHERE id = ?`, [role, targetId]);
  return {};
}
