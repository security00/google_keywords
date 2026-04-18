"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
}

export default function SettingsPage() {
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const activeKeys = keys.filter((k) => k.active);

  const fetchData = useCallback(async () => {
    try {
      const [accessRes, keysRes] = await Promise.all([
        fetch("/api/auth/access"),
        fetch("/api/auth/keys"),
      ]);
      if (!accessRes.ok || !keysRes.ok) throw new Error("Unauthorized");
      const accessData = await accessRes.json();
      const keysData = await keysRes.json();
      setAccess(accessData);
      setKeys(keysData.keys || []);
    } catch {
      setError("请先登录");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGenerateKey = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName || "default" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setNewKey(data.key);
      setNewKeyName("");
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
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <h2 className="text-2xl font-bold">账号设置</h2>

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
          <div className="grid grid-cols-3 gap-4">
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
            <div className="flex items-center gap-2">
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
                className="flex items-center justify-between rounded-xl border border-border/70 bg-background/55 px-4 py-3 shadow-sm shadow-black/5 dark:bg-background/35 dark:shadow-black/20"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{k.name}</span>
                  </div>
                  <code className="text-xs text-muted-foreground">{k.key}</code>
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
        <div className="mt-4 flex items-center gap-2">
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
        {!canManageApiKeys && (
          <p className="mt-3 text-sm text-muted-foreground">
            账号开通后才可以生成和管理 API Key。
          </p>
        )}
      </div>

      {/* 管理后台入口 */}
      {access.role === "admin" && (
        <Link href="/dashboard/admin/codes" className="flex items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/8 p-4 text-primary transition-colors hover:bg-primary/12">
          <Settings className="h-5 w-5" />
          进入管理后台
        </Link>
      )}

      {/* 使用说明 */}
      <div className="rounded-xl border border-border/70 bg-muted/35 p-5 shadow-sm shadow-black/5 dark:shadow-black/20">
        <h3 className="mb-2 font-semibold">使用说明</h3>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>
            1. 生成 API Key 后，用以下方式调用接口：
          </li>
          <li className="ml-4">
            <code className="rounded-md border border-border/60 bg-background/70 px-1.5 py-0.5 text-xs">
              Authorization: Bearer gk_live_xxxx
            </code>
          </li>
          <li className="ml-4">
            <code className="rounded-md border border-border/60 bg-background/70 px-1.5 py-0.5 text-xs">
              ?api_key=gk_live_xxxx
            </code>
          </li>
          <li>2. 每天最多 3 次 API 调用，缓存命中不计入</li>
          <li>3. 试用期为 90 天，到期后需续费</li>
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
