"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { RefreshCw, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AllowlistEntry = {
  ownerId: string;
  email: string;
  role: string | null;
  source: "env" | "database" | "both";
  createdBy: string | null;
  createdAt: string | null;
  dailyBudgetUsd: number | null;
  maxConcurrentJobs: number | null;
  removable: boolean;
};

const sourceLabel = (source: AllowlistEntry["source"]) => {
  if (source === "env") return "环境变量钉死";
  if (source === "both") return "环境变量 + 后台";
  return "后台添加";
};

export default function ByokAllowlistPage() {
  const [items, setItems] = useState<AllowlistEntry[]>([]);
  const [email, setEmail] = useState("");
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState("0.05");
  const [maxConcurrentJobs, setMaxConcurrentJobs] = useState("1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/byok-allowlist", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "无法读取 BYOK 名单");
      }
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取 BYOK 名单");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grant = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const budget = Number(dailyBudgetUsd);
      const concurrent = Number(maxConcurrentJobs);
      const response = await fetch("/api/admin/byok-allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          dailyBudgetUsd: Number.isFinite(budget) ? budget : undefined,
          maxConcurrentJobs: Number.isInteger(concurrent) ? concurrent : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "添加失败");
      }
      setEmail("");
      setNotice(`已加入 ${payload.item?.email || email}。对方仍需自己保存 DataForSEO / OpenRouter 密钥。`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "添加失败");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (entry: AllowlistEntry) => {
    if (!entry.removable) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/byok-allowlist", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerId: entry.ownerId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "移除失败");
      }
      setNotice(
        payload.stillAllowed
          ? `${entry.email} 已从后台名单移除，但仍被环境变量钉死，需要改 wrangler.jsonc 才能完全关掉。`
          : `已移除 ${entry.email}`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移除失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">BYOK 测试名单</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            用邮箱把已有账号加入 BYOK，不必改环境变量、也不必重新部署。
            新测试员默认写入 $0.05/天、并发 1；环境变量里的账号仍然钉死，后台不能摘掉。
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <form onSubmit={(event) => void grant(event)} className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 font-medium">
          <UserPlus className="h-4 w-4" />
          添加测试员
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_120px_120px_auto]">
          <Input
            type="email"
            required
            placeholder="student@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            type="number"
            min="0.000001"
            step="0.01"
            value={dailyBudgetUsd}
            onChange={(event) => setDailyBudgetUsd(event.target.value)}
            aria-label="每日预算 USD"
          />
          <Input
            type="number"
            min="1"
            step="1"
            value={maxConcurrentJobs}
            onChange={(event) => setMaxConcurrentJobs(event.target.value)}
            aria-label="最大并发"
          />
          <Button type="submit" disabled={saving || !email.trim()}>
            加入名单
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          账号必须已经注册。预算只在该用户还没有 spend control 时写入，不会覆盖已有设置。
        </p>
      </form>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">邮箱</th>
              <th className="px-3 py-2">角色</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2">日预算</th>
              <th className="px-3 py-2">并发</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <tr key={entry.ownerId} className="border-t">
                <td className="px-3 py-2">
                  <div>{entry.email}</div>
                  <div className="font-mono text-xs text-muted-foreground">{entry.ownerId}</div>
                </td>
                <td className="px-3 py-2">{entry.role || "-"}</td>
                <td className="px-3 py-2">{sourceLabel(entry.source)}</td>
                <td className="px-3 py-2">
                  {entry.dailyBudgetUsd === null ? "默认" : `$${entry.dailyBudgetUsd}`}
                </td>
                <td className="px-3 py-2">{entry.maxConcurrentJobs ?? "默认"}</td>
                <td className="px-3 py-2 text-right">
                  {entry.removable ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void revoke(entry)}
                    >
                      移除
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">需改环境变量</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-muted-foreground" colSpan={6}>
                  还没有后台测试员。环境变量名单为空时，这里也会是空的。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
