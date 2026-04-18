"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type User = {
  id: string;
  email: string;
  role: string;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  created_at: string;
};

const roleConfig: Record<string, { label: string; color: string }> = {
  admin: { label: "管理员", color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" },
  student: { label: "学生", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  banned: { label: "已封禁", color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
};

type TabKey = "all" | "pending";

export default function UsersPage() {
  const [tab, setTab] = useState<TabKey>("all");

  // All users (paginated)
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Pending users (separate fetch)
  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingTotalCount, setPendingTotalCount] = useState(0);
  const [pendingTotalPages, setPendingTotalPages] = useState(1);

  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const pageSize = 20;

  // Fetch all users
  const fetchUsers = useCallback(async (targetPage?: number) => {
    const p = targetPage ?? page;
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/users?page=${p}&pageSize=${pageSize}`);
      if (!res.ok) throw new Error("Unauthorized");
      const data = await res.json();
      setUsers(data.users || []);
      setTotalCount(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page]);

  // Fetch pending users
  const fetchPendingUsers = useCallback(async (targetPage?: number) => {
    const p = targetPage ?? pendingPage;
    try {
      setPendingLoading(true);
      const res = await fetch(`/api/admin/users?filter=pending&page=${p}&pageSize=${pageSize}`);
      if (!res.ok) throw new Error("Unauthorized");
      const data = await res.json();
      setPendingUsers(data.users || []);
      setPendingTotalCount(data.total ?? 0);
      setPendingTotalPages(data.totalPages ?? 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setPendingLoading(false);
    }
  }, [pendingPage]);

  useEffect(() => {
    fetchUsers();
    fetchPendingUsers();
  }, []);

  const getTrialDaysLeft = (u: User) => {
    if (!u.trial_expires_at) return null;
    return Math.ceil((new Date(u.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const makeGoToPage = (kind: "all" | "pending") => (p: number) => {
    if (kind === "all") {
      const target = Math.max(1, Math.min(totalPages, p));
      setPage(target);
      fetchUsers(target);
    } else {
      const target = Math.max(1, Math.min(pendingTotalPages, p));
      setPendingPage(target);
      fetchPendingUsers(target);
    }
  };

  const toggleUser = (userId: string, checked: boolean) => {
    setSelectedUserIds((prev) =>
      checked ? Array.from(new Set([...prev, userId])) : prev.filter((id) => id !== userId)
    );
  };

  const toggleAllPending = (checked: boolean) => {
    setSelectedUserIds(checked ? pendingUsers.map((u) => u.id) : []);
  };

  const activateSelectedUsers = async () => {
    if (selectedUserIds.length === 0) return;
    setActionLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate_trial", userIds: selectedUserIds, trialDays: 90 }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "批量开通失败");
      setMessage(payload?.message || "批量开通成功");
      setSelectedUserIds([]);
      fetchUsers();
      fetchPendingUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "批量开通失败");
    } finally {
      setActionLoading(false);
    }
  };

  const Pagination = ({ current, total, count, goToPage }: { current: number; total: number; count: number; goToPage: (p: number) => void }) => {
    const rangeStart = count === 0 ? 0 : (current - 1) * pageSize + 1;
    const rangeEnd = Math.min(current * pageSize, count);
    return (
      <div className="flex flex-col gap-2 items-center justify-between md:flex-row text-sm text-muted-foreground">
        <span>共 {count} 条，显示 {rangeStart}-{rangeEnd}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={current <= 1} onClick={() => goToPage(current - 1)}>上一页</Button>
          <span className="min-w-16 text-center">{current} / {total}</span>
          <Button variant="outline" size="sm" disabled={current >= total} onClick={() => goToPage(current + 1)}>下一页</Button>
        </div>
      </div>
    );
  };

  const isLoading = (tab === "all" ? loading : pendingLoading) && (tab === "all" ? users.length === 0 : pendingUsers.length === 0);
  if (isLoading) return <div className="py-10 text-center text-muted-foreground">加载中...</div>;

  const currentUsers = tab === "all" ? users : pendingUsers;
  const currentLoading = tab === "all" ? loading : pendingLoading;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h2 className="text-2xl font-bold">用户管理</h2>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {message && <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

      {/* Tabs */}
      <div className="flex border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "all"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setTab("all")}
        >
          全部用户
          <span className="ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">{totalCount}</span>
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "pending"
              ? "border-amber-500 text-amber-700 dark:text-amber-400"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => { setTab("pending"); setSelectedUserIds([]); }}
        >
          待激活学员
          <span className="ml-1.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 px-2 py-0.5 text-xs">{pendingTotalCount}</span>
        </button>
      </div>

      {/* Pending tab: batch actions */}
      {tab === "pending" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-amber-800 dark:text-amber-300">
              已选择 {selectedUserIds.length} / {pendingUsers.length} 人
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => toggleAllPending(true)} disabled={actionLoading || pendingUsers.length === 0}>
                全选
              </Button>
              <Button size="sm" onClick={activateSelectedUsers} disabled={actionLoading || selectedUserIds.length === 0}>
                批量开通 90 天
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className={`relative overflow-x-auto rounded-lg border transition-opacity ${currentLoading ? "opacity-60 pointer-events-none" : ""}`}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {tab === "pending" && (
                <th className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={pendingUsers.length > 0 && selectedUserIds.length === pendingUsers.length}
                    onChange={(e) => toggleAllPending(e.target.checked)}
                    aria-label="全选"
                  />
                </th>
              )}
              <th className="px-3 py-2 text-left">邮箱</th>
              <th className="px-3 py-2 text-left">角色</th>
              <th className="px-3 py-2 text-left">试用剩余</th>
              <th className="px-3 py-2 text-left">注册时间</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {currentUsers.length === 0 ? (
              <tr>
                <td colSpan={tab === "pending" ? 6 : 5} className="px-3 py-8 text-center text-muted-foreground">
                  {tab === "pending" ? "没有待激活学员" : "没有用户"}
                </td>
              </tr>
            ) : (
              currentUsers.map((u) => {
                const rc = roleConfig[u.role] || roleConfig.student;
                const daysLeft = getTrialDaysLeft(u);
                return (
                  <tr key={u.id} className="border-b hover:bg-muted/30">
                    {tab === "pending" && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(u.id)}
                          onChange={(e) => toggleUser(u.id, e.target.checked)}
                          aria-label={`选择 ${u.email}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${rc.color}`}>{rc.label}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {daysLeft === null
                        ? u.role === "student" ? "待激活" : "-"
                        : daysLeft > 9999 ? "永久"
                        : daysLeft > 0 ? `${daysLeft} 天`
                        : "已过期"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/dashboard/admin/users/${u.id}`} className="text-blue-600 hover:underline dark:text-blue-400 text-xs">
                        详情
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {tab === "all" ? (
        <Pagination current={page} total={totalPages} count={totalCount} goToPage={makeGoToPage("all")} />
      ) : (
        <Pagination current={pendingPage} total={pendingTotalPages} count={pendingTotalCount} goToPage={makeGoToPage("pending")} />
      )}
    </div>
  );
}
