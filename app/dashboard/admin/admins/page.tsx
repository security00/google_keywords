"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Shield, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

const FOUNDING_ADMIN_EMAIL = "xiangqiling5204@gmail.com";

type AdminUser = {
  id: string;
  email: string;
  role: string;
  created_at: string;
};

export default function AdminsPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchAdmins = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/admins");
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "加载失败");
      setAdmins(payload.admins || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const addAdmin = async (e: FormEvent) => {
    e.preventDefault();
    const targetEmail = email.trim();
    if (!targetEmail) return;

    setActionLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "添加失败");
      setEmail("");
      setMessage(`已添加管理员：${targetEmail}`);
      fetchAdmins();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setActionLoading(false);
    }
  };

  const removeAdmin = async (admin: AdminUser) => {
    if (!confirm(`确定移除 ${admin.email} 的管理员权限？`)) return;

    setActionLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/admins?id=${encodeURIComponent(admin.id)}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "移除失败");
      setMessage(`已移除管理员：${admin.email}`);
      fetchAdmins();
    } catch (e) {
      setError(e instanceof Error ? e.message : "移除失败");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold">
          <Shield className="h-6 w-6" /> 管理员管理
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">查看管理员列表，按邮箱添加管理员，或移除管理员权限。</p>
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}
      {message && <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}

      <form onSubmit={addAdmin} className="rounded-lg border bg-card p-4">
        <label className="mb-2 block text-sm font-medium">添加管理员</label>
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="h-10 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <Button type="submit" disabled={actionLoading || !email.trim()}>添加为管理员</Button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left">邮箱</th>
              <th className="px-3 py-2 text-left">注册时间</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">加载中...</td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-8 text-center text-muted-foreground">暂无管理员</td></tr>
            ) : (
              admins.map((admin) => {
                const isFoundingAdmin = admin.email.toLowerCase() === FOUNDING_ADMIN_EMAIL;
                return (
                  <tr key={admin.id} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-2">
                      {admin.email}
                      {isFoundingAdmin && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">创始管理员</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(admin.created_at).toLocaleDateString("zh-CN")}</td>
                    <td className="px-3 py-2 text-right">
                      {isFoundingAdmin ? (
                        <span className="text-xs text-muted-foreground">不可移除</span>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => removeAdmin(admin)} disabled={actionLoading}>
                          <Trash2 className="mr-1 h-4 w-4" /> 移除管理员
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
