"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2, Shield, Ban, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type UserDetail = {
  id: string;
  email: string;
  role: string;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  created_at: string;
  api_keys: { id: number; name: string; key: string; active: number; created_at: string }[];
  invite_codes: { code: string; max_uses: number; current_uses: number }[];
  daily_usage: { date: string; api_calls: number }[];
};

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [userId, setUserId] = useState("");
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    params.then((p) => {
      setUserId(p.id);
      fetchUser(p.id);
    });
    // Get current user ID for self-check
    fetch("/api/auth/access")
      .then((r) => r.json())
      .then((d) => { if (d.userId) setCurrentUserId(d.userId); })
      .catch(() => {});
  }, []);

  const fetchUser = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/users/${id}`);
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setUser(data.user);
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (newRole: string) => {
    if (!userId || !confirm(`确定将此用户角色改为 ${newRole}？`)) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error("Failed");
      fetchUser(userId);
    } catch {
      setError("操作失败");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="py-10 text-center text-muted-foreground">加载中...</div>;
  if (!user) return <div className="py-10 text-center text-red-500">{error || "用户不存在"}</div>;

  const trialDays = user.trial_expires_at
    ? Math.ceil((new Date(user.trial_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button onClick={() => router.push("/dashboard/admin/users")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 返回用户列表
      </button>

      {/* 用户信息 */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{user.email}</h2>
            <p className="text-sm text-muted-foreground">ID: {user.id}</p>
          </div>
          <div className="flex gap-2">
            {user.role !== "banned" && (
              <Button size="sm" variant="destructive" onClick={() => handleRoleChange("banned")} disabled={actionLoading || currentUserId === user.id}>
                <Ban className="mr-1 h-4 w-4" /> 封禁
              </Button>
            )}
            {user.role === "banned" && (
              <Button size="sm" onClick={() => handleRoleChange("student")} disabled={actionLoading}>
                <UserCheck className="mr-1 h-4 w-4" /> 解封
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><span className="text-muted-foreground">角色：</span>{user.role}</div>
          <div><span className="text-muted-foreground">试用剩余：</span>{trialDays === null ? "-" : trialDays > 9999 ? "永久" : trialDays > 0 ? `${trialDays} 天` : "已过期"}</div>
          <div><span className="text-muted-foreground">注册时间：</span>{new Date(user.created_at).toLocaleDateString("zh-CN")}</div>
        </div>
      </div>

      {/* API Keys */}
      <div className="rounded-lg border bg-card p-5">
        <h3 className="mb-3 font-semibold">API Keys ({user.api_keys.length})</h3>
        {user.api_keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无 API Key</p>
        ) : (
          <div className="space-y-2">
            {user.api_keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{k.name}</span>
                  {!k.active && <span className="ml-2 text-xs text-red-500">已撤销</span>}
                  <div className="text-xs text-muted-foreground">{k.key} · {new Date(k.created_at).toLocaleDateString("zh-CN")}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 邀请码 */}
      <div className="rounded-lg border bg-card p-5">
        <h3 className="mb-3 font-semibold">关联邀请码</h3>
        {user.invite_codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无</p>
        ) : (
          <div className="space-y-1 text-sm">
            {user.invite_codes.map((c) => (
              <div key={c.code} className="flex items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.code}</code>
                <span className="text-muted-foreground">使用 {c.current_uses}/{c.max_uses}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 用量记录 */}
      <div className="rounded-lg border bg-card p-5">
        <h3 className="mb-3 font-semibold">近期用量（最近 30 天）</h3>
        {user.daily_usage.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无使用记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="px-2 py-1 text-left">日期</th>
                  <th className="px-2 py-1 text-right">API 调用</th>
                </tr>
              </thead>
              <tbody>
                {user.daily_usage.map((d) => (
                  <tr key={d.date} className="border-b">
                    <td className="px-2 py-1">{d.date}</td>
                    <td className="px-2 py-1 text-right">{d.api_calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}
    </div>
  );
}
