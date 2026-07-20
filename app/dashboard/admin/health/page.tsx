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

type PipelineRunHealth = {
  pipeline: string;
  run_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  error: string | null;
  actual_cost_usd: number | null;
  estimated_cost_usd: number | null;
  accounted_cost_usd: number | null;
  cost_event_count: number;
  failed_task_count: number;
};

type OperationsHealth = {
  available: boolean;
  latestRuns: PipelineRunHealth[];
  totals: {
    running_count: number;
    failed_runs_24h: number;
    failed_tasks_24h: number;
    actual_cost_24h: number | null;
    estimated_cost_24h: number | null;
    accounted_cost_24h: number | null;
    platform_cost_24h: number | null;
    user_cost_24h: number | null;
    stale_running_count: number;
    orphan_task_cost_count: number;
    missing_event_key_24h: number;
  } | null;
  error?: string;
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

const formatCost = (value?: number | null) =>
  value === null || value === undefined ? "-" : `$${Number(value).toFixed(4)}`;

export default function AdminHealthPage() {
  const [latest, setLatest] = useState<HealthItem | null>(null);
  const [items, setItems] = useState<HealthItem[]>([]);
  const [operations, setOperations] = useState<OperationsHealth | null>(null);
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
      setOperations(data.operations ?? null);
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

      <section className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold">管线运行概况</h3>
          <p className="text-sm text-muted-foreground">只读汇总最近运行、失败任务和过去 24 小时成本。</p>
        </div>
        {!operations?.available ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            管线账本暂不可用：{operations?.error || "暂无数据"}
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <HealthStat label="运行中" value={operations.totals?.running_count ?? 0} />
              <HealthStat label="24h 失败 run" value={operations.totals?.failed_runs_24h ?? 0} warning={(operations.totals?.failed_runs_24h ?? 0) > 0} />
              <HealthStat label="24h 失败 task" value={operations.totals?.failed_tasks_24h ?? 0} warning={(operations.totals?.failed_tasks_24h ?? 0) > 0} />
              <HealthStat label="24h 计入成本" value={formatCost(operations.totals?.accounted_cost_24h)} />
              <HealthStat label="陈旧运行 (>2h)" value={operations.totals?.stale_running_count ?? 0} warning={(operations.totals?.stale_running_count ?? 0) > 0} />
              <HealthStat label="孤立成本事件" value={operations.totals?.orphan_task_cost_count ?? 0} warning={(operations.totals?.orphan_task_cost_count ?? 0) > 0} />
              <HealthStat label="24h 无幂等键成本" value={operations.totals?.missing_event_key_24h ?? 0} warning={(operations.totals?.missing_event_key_24h ?? 0) > 0} />
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card/90 shadow-sm">
              <table className="w-full min-w-[820px] text-sm">
                <thead><tr className="border-b bg-muted/40">
                  <th className="px-4 py-3 text-left">Pipeline</th><th className="px-4 py-3 text-left">状态</th><th className="px-4 py-3 text-left">最近开始</th><th className="px-4 py-3 text-left">耗时</th><th className="px-4 py-3 text-left">失败任务</th><th className="px-4 py-3 text-left">成本</th><th className="px-4 py-3 text-left">错误</th>
                </tr></thead>
                <tbody>{operations.latestRuns.length === 0 ? <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">暂无最近运行记录</td></tr> : operations.latestRuns.map((run) => <tr key={run.run_id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{run.pipeline}</td><td className="px-4 py-3">{run.status}</td><td className="px-4 py-3 whitespace-nowrap">{formatTime(run.started_at)}</td><td className="px-4 py-3">{run.duration_seconds ?? "-"}s</td><td className="px-4 py-3">{run.failed_task_count}</td><td className="px-4 py-3">{formatCost(run.accounted_cost_usd)}</td><td className="max-w-[280px] truncate px-4 py-3 text-red-600" title={run.error || ""}>{run.error || "-"}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </>
        )}
      </section>

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

function HealthStat({ label, value, warning = false }: { label: string; value: string | number; warning?: boolean }) {
  return <div className={`rounded-xl border p-4 ${warning ? "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40" : "border-border/70 bg-card/90"}`}><div className="text-sm text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-semibold ${warning ? "text-amber-700 dark:text-amber-300" : ""}`}>{value}</div></div>;
}
