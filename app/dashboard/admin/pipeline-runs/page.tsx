"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type PipelineRun = {
  run_id: string;
  pipeline: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  checked_count: number | null;
  saved_count: number | null;
  estimated_cost_usd: number | null;
  cost_event_count: number | null;
  error: string | null;
};

const statusClass = (status: string) => {
  if (status === "success") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  if (status === "failed") return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  if (status === "running") return "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300";
  return "bg-muted text-muted-foreground";
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
};

const formatCost = (value: number | null) => {
  if (value === null || value === undefined) return "-";
  return `$${Number(value).toFixed(4)}`;
};

export default function AdminPipelineRunsPage() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/pipeline-runs?page=${page}&pageSize=20`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "加载失败");
      setRuns(data.runs || []);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">管线运行记录</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            查看预计算、老词、新游等后台管线的 run_id、状态、耗时和成本字段。当前成本字段允许为空，后续会逐步补全。
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadRuns()} disabled={loading}>
          刷新
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Pipeline</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">Run ID</th>
                <th className="px-4 py-3">开始</th>
                <th className="px-4 py-3">结束</th>
                <th className="px-4 py-3">耗时</th>
                <th className="px-4 py-3">检查/保存</th>
                <th className="px-4 py-3">估算成本</th>
                <th className="px-4 py-3">成本事件</th>
                <th className="px-4 py-3">错误</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="px-4 py-8 text-center text-muted-foreground" colSpan={10}>加载中...</td></tr>
              ) : runs.length === 0 ? (
                <tr><td className="px-4 py-8 text-center text-muted-foreground" colSpan={10}>暂无运行记录</td></tr>
              ) : runs.map((run) => (
                <tr key={run.run_id} className="border-t align-top">
                  <td className="px-4 py-3 font-medium">{run.pipeline}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(run.status)}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-3 font-mono text-xs" title={run.run_id}>{run.run_id}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(run.started_at)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(run.completed_at)}</td>
                  <td className="px-4 py-3">{run.duration_seconds ?? "-"}s</td>
                  <td className="px-4 py-3">{run.checked_count ?? "-"} / {run.saved_count ?? "-"}</td>
                  <td className="px-4 py-3">{formatCost(run.estimated_cost_usd)}</td>
                  <td className="px-4 py-3">{run.cost_event_count ?? 0}</td>
                  <td className="max-w-[240px] truncate px-4 py-3 text-red-600" title={run.error || ""}>{run.error || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          上一页
        </Button>
        <span className="text-sm text-muted-foreground">第 {page} / {totalPages} 页</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
          下一页
        </Button>
      </div>
    </div>
  );
}
