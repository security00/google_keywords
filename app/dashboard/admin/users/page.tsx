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

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Unauthorized");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const getTrialDaysLeft = (u: User) => {
    if (!u.trial_expires_at) return null;
    const diff = Math.ceil((new Date(u.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  if (loading) return <div className="py-10 text-center text-muted-foreground">加载中...</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h2 className="text-2xl font-bold">用户管理</h2>
      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left">邮箱</th>
              <th className="px-3 py-2 text-left">角色</th>
              <th className="px-3 py-2 text-left">试用剩余</th>
              <th className="px-3 py-2 text-left">注册时间</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const rc = roleConfig[u.role] || roleConfig.student;
              const daysLeft = getTrialDaysLeft(u);
              return (
                <tr key={u.id} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${rc.color}`}>{rc.label}</span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {daysLeft === null ? "-" : daysLeft > 9999 ? "永久" : daysLeft > 0 ? `${daysLeft} 天` : "已过期"}
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
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
