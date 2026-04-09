import { d1Query } from "@/lib/d1";

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
  daily_usage: { date: string; expand_calls: number; compare_calls: number }[];
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

export async function requireAdmin(request: Request): Promise<{ userId: string; error?: string }> {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("session="))
    ?.split("=")[1];

  if (!token) return { userId: "", error: "Unauthorized" };

  const { rows } = await d1Query<{ user_id: string }>(
    `SELECT user_id FROM auth_sessions WHERE token = ? AND expires_at > datetime('now') LIMIT 1`,
    [token]
  );

  if (!rows.length) return { userId: "", error: "Unauthorized" };

  const userId = rows[0].user_id;
  const { rows: users } = await d1Query<{ role: string }>(
    `SELECT role FROM auth_users_v2 WHERE id = ? LIMIT 1`,
    [userId]
  );

  if (!users.length || users[0].role !== "admin") {
    return { userId: "", error: "Forbidden: admin only" };
  }

  return { userId };
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

export async function listUsers(): Promise<AdminUser[]> {
  const { rows } = await d1Query<AdminUser>(
    `SELECT id, email, role, trial_started_at, trial_expires_at, created_at
     FROM auth_users_v2 ORDER BY created_at DESC`
  );
  return rows;
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
      `SELECT date, expand_calls, compare_calls FROM daily_api_usage WHERE user_id = ? ORDER BY date DESC LIMIT 30`,
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
