"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Copy,
  Plus,
  Trash2,
  Key,
  Clock,
  Zap,
  Shield,
  Check,
  AlertCircle,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ByokSettings } from "@/components/byok-settings";

interface AccessInfo {
  userId: string;
  email: string;
  role?: string;
  trial?: { active: boolean; daysLeft: number; expiresAt: string | null };
  quota?: { used: number; limit: number };
  blocked?: boolean;
  blockedReason?: string;
  blockedCode?: string;
}

interface ApiKeyItem {
  id: number;
  key: string;
  name: string;
  created_at: string;
  expires_at: string | null;
  active: number;
  scopes: Array<"cache:read" | "provider:execute" | "byok:execute">;
}

interface BillingStatus {
  entitlement: {
    allowed: boolean;
    source: string;
    planKey: string | null;
    status: string;
    expiresAt: string | null;
    briefLimit: number;
    briefUsed: number;
    reason?: string;
  };
}

function SettingsPageContent() {
  const searchParams = useSearchParams();
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newKeyByokEnabled, setNewKeyByokEnabled] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const activeKeys = keys.filter((k) => k.active);

  const fetchData = useCallback(async () => {
    try {
      const [accessRes, keysRes, billingRes] = await Promise.all([
        fetch("/api/auth/access", { credentials: "include", cache: "no-store" }),
        fetch("/api/auth/keys", { credentials: "include", cache: "no-store" }),
        fetch("/api/billing/status", { credentials: "include", cache: "no-store" }),
      ]);
      if (accessRes.status === 401 || keysRes.status === 401) throw new Error("请先登录");
      if (!accessRes.ok) {
        const payload = await accessRes.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to load account access");
      }
      if (!keysRes.ok) {
        const payload = await keysRes.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to load API keys");
      }
      const accessData = await accessRes.json();
      const keysData = await keysRes.json();
      setAccess(accessData);
      setKeys(keysData.keys || []);
      if (billingRes.ok) {
        setBilling(await billingRes.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncCheckout = async () => {
      const sessionId = searchParams.get("session_id");
      if (searchParams.get("billing") === "success") {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/billing/sync", {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          setError(payload?.error || "Payment succeeded, but subscription sync is still pending.");
        }
      }
      await fetchData();
    };

    syncCheckout();
  }, [fetchData, searchParams]);

  const handleGenerateKey = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newKeyName || "default",
          scopes: newKeyByokEnabled ? ["cache:read", "byok:execute"] : ["cache:read"],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setNewKey(data.key);
      setNewKeyName("");
      setNewKeyByokEnabled(false);
      fetchData(); // refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeKey = async (keyId: number) => {
    if (!confirm("确定要撤销这个 API Key 吗？撤销后无法恢复。")) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId }),
      });
      if (!res.ok) throw new Error("撤销失败");
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "撤销失败");
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const canManageApiKeys = access ? !access.blocked : false;

  const openBillingUrl = async (endpoint: "/api/billing/checkout" | "/api/billing/portal") => {
    setActionLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "include" });
      const payload = await response.json();
      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(payload?.error || "Billing action failed");
      }
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing action failed");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (!access) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-6 text-center shadow-sm shadow-red-950/10">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-500" />
          <p className="text-red-700 dark:text-red-200">{error || "请先登录"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2 sm:py-6">
      <h2 className="text-2xl font-bold">账号设置</h2>

      <div className="rounded-xl border border-border/80 bg-card/90 p-5 shadow-sm shadow-black/5 backdrop-blur-sm dark:shadow-black/25">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">SaaS access</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {billing?.entitlement.allowed
                ? `Active via ${billing.entitlement.source}`
                : billing?.entitlement.reason || "Subscription required after trial."}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={actionLoading}
              onClick={() => openBillingUrl("/api/billing/checkout")}
            >
              Subscribe
            </Button>
            {billing?.entitlement.source === "stripe" && (
              <Button
                type="button"
                variant="secondary"
                disabled={actionLoading}
                onClick={() => openBillingUrl("/api/billing/portal")}
              >
                Manage billing
              </Button>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Plan</div>
            <div className="font-medium">{billing?.entitlement.planKey || "-"}</div>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Status</div>
            <div className="font-medium">{billing?.entitlement.status || "-"}</div>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground">Build Briefs</div>
            <div className="font-medium">
              {billing ? `${billing.entitlement.briefUsed} / ${billing.entitlement.briefLimit}` : "-"}
            </div>
          </div>
        </div>
      </div>

      {/* 账号状态 */}
      {access.blocked ? (
        <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-5 shadow-sm shadow-red-950/10">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-200">
            <AlertCircle className="h-5 w-5" />
            <span className="font-medium">
              {access.blockedCode === "trial_inactive"
                ? "等待管理员开通"
                : access.blockedCode === "trial_expired"
                ? "试用期已过期"
                : access.blockedCode === "quota_exceeded"
                ? "今日配额已用完"
                : "账号受限"}
            </span>
          </div>
          <p className="mt-2 text-sm text-red-600 dark:text-red-300">
            {access.blockedReason}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-5 shadow-sm shadow-emerald-950/10">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <div className="text-center">
              <Shield className="mx-auto mb-1 h-6 w-6 text-emerald-600 dark:text-emerald-300" />
              <div className="text-xs text-emerald-700 dark:text-emerald-300">状态</div>
              <div className="font-semibold text-emerald-800 dark:text-emerald-100">
                {access.role === "admin" ? "管理员" : "正常"}
              </div>
            </div>
            <div className="text-center">
              <Clock className="mx-auto mb-1 h-6 w-6 text-emerald-600 dark:text-emerald-300" />
              <div className="text-xs text-emerald-700 dark:text-emerald-300">
                试用剩余
              </div>
              <div className="font-semibold text-emerald-800 dark:text-emerald-100">
                {access.trial
                  ? access.trial.daysLeft === Infinity
                    ? "永久"
                    : `${access.trial.daysLeft} 天`
                  : "-"}
              </div>
            </div>
            <div className="text-center">
              <Zap className="mx-auto mb-1 h-6 w-6 text-emerald-600 dark:text-emerald-300" />
              <div className="text-xs text-emerald-700 dark:text-emerald-300">
                今日用量
              </div>
              <div className="font-semibold text-emerald-800 dark:text-emerald-100">
                {access.quota
                  ? access.quota.limit >= 999
                    ? "不限"
                    : `${access.quota.used} / ${access.quota.limit}`
                  : "-"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Keys */}
      <div className="rounded-xl border border-border/80 bg-card/90 p-5 shadow-sm shadow-black/5 backdrop-blur-sm dark:shadow-black/25">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Key className="h-5 w-5" /> API Keys
          </h3>
          <span className="text-xs text-muted-foreground">
            {activeKeys.length} / 5
          </span>
        </div>

        {/* 新生成的 key 提示 */}
        {newKey && (
          <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
            <p className="mb-2 text-sm font-medium text-amber-900 dark:text-amber-200">
              ⚠️ 请立即保存此 Key，关闭后将无法再次查看
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="flex-1 overflow-x-auto rounded-lg border border-amber-500/15 bg-black/[0.03] px-3 py-2 text-sm dark:bg-white/[0.04]">
                {newKey}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(newKey, "new")}
              >
                {copied === "new" ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => setNewKey(null)}
            >
              我已保存
            </Button>
          </div>
        )}

        {/* Key 列表 */}
        {activeKeys.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            还没有 API Key，点击下方按钮生成
          </p>
        ) : (
          <div className="space-y-2">
            {activeKeys.map((k) => (
              <div
                key={k.id}
              className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/55 px-4 py-3 shadow-sm shadow-black/5 dark:bg-background/35 dark:shadow-black/20 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{k.name}</span>
                    {k.scopes?.includes("byok:execute") && (
                      <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        BYOK execute
                      </span>
                    )}
                  </div>
                  <code className="block break-all text-xs text-muted-foreground">{k.key}</code>
                  <div className="text-xs text-muted-foreground">
                    创建于 {new Date(k.created_at).toLocaleDateString("zh-CN")}
                  </div>
                </div>
                {k.active && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-2 text-red-500 hover:text-red-700"
                    onClick={() => handleRevokeKey(k.id)}
                    disabled={actionLoading}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 生成新 key */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Key 名称（可选）"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 rounded-lg border border-input bg-background/80 px-3 py-2 text-sm shadow-inner shadow-black/5 dark:bg-background/60"
            onKeyDown={(e) => e.key === "Enter" && handleGenerateKey()}
            disabled={!canManageApiKeys || actionLoading}
          />
          <Button
            className="w-full sm:w-auto"
            onClick={handleGenerateKey}
            disabled={
              !canManageApiKeys ||
              actionLoading ||
              activeKeys.length >= 5
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            生成 Key
          </Button>
        </div>
        <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={newKeyByokEnabled}
            onChange={(event) => setNewKeyByokEnabled(event.target.checked)}
          />
          <span>
            <strong>允许使用我的 Provider 额度</strong>
            <span className="mt-1 block text-xs text-muted-foreground">
              为新 Key 增加 byok:execute 权限。持有者可以通过 API 消耗你已连接的 DataForSEO 和 OpenRouter 额度。
            </span>
          </span>
        </label>
        {!canManageApiKeys && (
          <p className="mt-3 text-sm text-muted-foreground">
            账号开通后才可以生成和管理 API Key。
          </p>
        )}
      </div>

      <ByokSettings />

      {/* 管理后台入口 */}
      {access.role === "admin" && (
        <Link href="/dashboard/admin/codes" className="flex items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/8 p-4 text-primary transition-colors hover:bg-primary/12">
          <Settings className="h-5 w-5" />
          进入管理后台
        </Link>
      )}

      {/* 使用说明 */}
      <div className="rounded-xl border border-border/70 bg-muted/35 p-5 shadow-sm shadow-black/5 dark:shadow-black/20">
        <h3 className="mb-2 font-semibold">Agent 使用说明</h3>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>
            1. 生成 API Key 后，将它配置到 <code className="rounded-md border border-border/60 bg-background/70 px-1.5 py-0.5 text-xs">keyword-research-agent</code> skill 中使用。
          </li>
          <li>2. API Key 代表你的账号权限，请妥善保存，不要公开分享。</li>
          <li>3. 账号需处于开通期内；试用期为 90 天，到期后需续费。</li>
        </ul>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-3 text-sm text-red-700 dark:text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-muted-foreground">Loading settings...</div>}>
      <SettingsPageContent />
    </Suspense>
  );
}
