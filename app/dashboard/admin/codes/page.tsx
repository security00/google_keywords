"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Copy, Plus, Trash2, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type InviteCode = {
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

const statusConfig = {
  available: { label: "可用", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" },
  used: { label: "已使用", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  exhausted: { label: "已用完", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" },
  expired: { label: "已过期", color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
};

export default function InviteCodesPage() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [showGen, setShowGen] = useState(false);
  const [genCount, setGenCount] = useState("1");
  const [genMaxUses, setGenMaxUses] = useState("1");
  const [genExpiry, setGenExpiry] = useState("90");
  const [genLoading, setGenLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCodes = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/invite-codes");
      if (!res.ok) throw new Error("Unauthorized");
      const data = await res.json();
      setCodes(data.codes || []);
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCodes();
  }, [fetchCodes]);

  const handleGenerate = async () => {
    setGenLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/invite-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count: Number(genCount),
          maxUsesPerCode: Number(genMaxUses),
          expiresInDays: Number(genExpiry) || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setShowGen(false);
      fetchCodes();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenLoading(false);
    }
  };

  const handleDelete = async (code: string) => {
    if (!confirm(`确定删除邀请码 ${code}？`)) return;
    try {
      const res = await fetch("/api/admin/invite-codes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error("删除失败");
      fetchCodes();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) return <div className="py-10 text-center text-muted-foreground">加载中...</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">邀请码管理</h2>
        <Button onClick={() => setShowGen(!showGen)} size="sm">
          <Plus className="mr-1 h-4 w-4" /> 生成邀请码
        </Button>
      </div>

      {/* 生成表单 */}
      {showGen && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm">数量</label>
              <input type="number" value={genCount} onChange={(e) => setGenCount(e.target.value)} min="1" max="100"
                className="w-full rounded border px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm">每码可用次数</label>
              <input type="number" value={genMaxUses} onChange={(e) => setGenMaxUses(e.target.value)} min="1" max="100"
                className="w-full rounded border px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm">有效期（天）</label>
              <input type="number" value={genExpiry} onChange={(e) => setGenExpiry(e.target.value)} min="1"
                className="w-full rounded border px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleGenerate} disabled={genLoading} size="sm">确认生成</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowGen(false)}>取消</Button>
          </div>
        </div>
      )}

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      {/* 统计 */}
      <div className="grid grid-cols-4 gap-3 text-center text-sm">
        {(["available", "used", "exhausted", "expired"] as const).map((s) => (
          <div key={s} className="rounded-lg border p-3">
            <div className="font-bold">{codes.filter((c) => c.status === s).length}</div>
            <div className="text-muted-foreground">{statusConfig[s].label}</div>
          </div>
        ))}
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left">邀请码</th>
              <th className="px-3 py-2 text-left">状态</th>
              <th className="px-3 py-2 text-left">使用</th>
              <th className="px-3 py-2 text-left">注册用户</th>
              <th className="px-3 py-2 text-left">有效期至</th>
              <th className="px-3 py-2 text-left">创建时间</th>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => {
              const sc = statusConfig[c.status];
              return (
                <tr key={c.code} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <code className="rounded bg-muted px-1.5 text-xs">{c.code}</code>
                    <button onClick={() => copy(c.code, c.code)} className="ml-1 text-muted-foreground hover:text-foreground">
                      {copied === c.code ? <Check className="inline h-3 w-3 text-green-500" /> : <Copy className="inline h-3 w-3" />}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${sc.color}`}>{sc.label}</span>
                  </td>
                  <td className="px-3 py-2">{c.current_uses}/{c.max_uses}</td>
                  <td className="px-3 py-2">
                    {c.user_email ? (
                      <Link href={`/dashboard/admin/users/${c.used_by}`} className="text-blue-600 hover:underline dark:text-blue-400">
                        {c.user_email}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {c.expires_at ? new Date(c.expires_at).toLocaleDateString("zh-CN") : "永久"}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => handleDelete(c.code)} className="text-muted-foreground hover:text-red-500">
                      <Trash2 className="inline h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {codes.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">暂无邀请码</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
