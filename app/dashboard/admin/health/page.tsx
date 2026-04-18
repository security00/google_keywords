"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, CheckCircle2, Clock3, RefreshCw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

type HealthItem = {
  sharedDate: string;
  status: string;
  stage: string;
  updatedAt?: string | null;
  stageStartedAt?: string | null;
  expandCompletedAt?: string | null;
  compareCompletedAt?: string | null;
  intentCompletedAt?: string | null;
  expandJobId?: string | null;
  compareJobId?: string | null;
  intentJobId?: string | null;
};

const statusConfig: Record<
  string,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  complete: {
    label: "正常",
    icon: CheckCircle2,
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  in_progress: {
    label: "进行中",
    icon: Clock3,
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  },
};

const formatTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";

export default function AdminHealthPage() {
  const [latest, setLatest] = useState<HealthItem | null>(null);
  const [items, setItems] = useState<HealthItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await fetch("/api/admin/health");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "加载失败");
      }
      setLatest(data.latest ?? null);
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  if (loading) {
    return <div className="py-10 text-center text-muted-foreground">加载中...</div>;
  }

  const latestStatus =
    statusConfig[latest?.status || ""] || {
      label: latest?.status || "未知",
      icon: XCircle,
      className:
        "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
    };
  const LatestIcon = latestStatus.icon;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <Activity className="h-6 w-6 text-primary" />
            系统健康
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            查看每日共享缓存预计算是否完整落盘。
          </p>
        </div>
        <Button variant="outline" onClick={() => fetchHealth(true)} disabled={refreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</div>}

      <div className="rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">今日共享缓存状态</div>
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${latestStatus.className}`}>
                <LatestIcon className="h-4 w-4" />
                {latestStatus.label}
              </span>
              <span className="text-sm text-muted-foreground">
                业务日期：{latest?.sharedDate || "-"}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              当前阶段：{latest?.stage || "-"}，最近更新：{formatTime(latest?.updatedAt)}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 text-sm text-muted-foreground md:text-right">
            <div>Expand 完成：{formatTime(latest?.expandCompletedAt)}</div>
            <div>Compare 完成：{formatTime(latest?.compareCompletedAt)}</div>
            <div>Intent 完成：{formatTime(latest?.intentCompletedAt)}</div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/90 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-3 text-left">业务日期</th>
              <th className="px-4 py-3 text-left">状态</th>
              <th className="px-4 py-3 text-left">阶段</th>
              <th className="px-4 py-3 text-left">Expand</th>
              <th className="px-4 py-3 text-left">Compare</th>
              <th className="px-4 py-3 text-left">Intent</th>
              <th className="px-4 py-3 text-left">最近更新</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const config =
                statusConfig[item.status] || {
                  label: item.status || "未知",
                  icon: XCircle,
                  className:
                    "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
                };
              return (
                <tr key={item.sharedDate} className="border-b last:border-b-0 hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{item.sharedDate}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium ${config.className}`}>
                      {config.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.stage || "-"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatTime(item.expandCompletedAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatTime(item.compareCompletedAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatTime(item.intentCompletedAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatTime(item.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
