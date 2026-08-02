"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

type Summary = {
  connection_count: number;
  verified_connection_count: number;
  byok_jobs_24h: number;
  completed_jobs_24h: number;
  partial_compare_jobs_24h: number;
  failed_jobs_24h: number;
  stale_started_jobs: number;
  committed_estimate_usd_24h: number | null;
  accounted_cost_usd_24h: number | null;
};

type Violations = {
  attribution_mismatch_count: number;
  shared_cache_violation_count: number;
  orphan_committed_quote_count: number;
  missing_cost_event_count: number;
  missing_event_key_count: number;
};

type StaleJob = {
  job_id: string;
  owner_id: string;
  job_type: string;
  provider_connection_id: string | null;
  provider_connection_version: number | null;
  status: string;
  provider_request_state: string;
  updated_at: string;
  cost_event_count: number;
  accounted_cost_usd: number | null;
};

type Reconciliation = {
  quote_id: string;
  capability: string;
  job_status: string | null;
  status: string;
  estimated_cost_usd: number;
  accounted_cost_usd: number | null;
  varianceUsd: number;
  created_at: string;
};

type Health = {
  generatedAt: string;
  window: { summaryFrom: string; reconciliationFrom: string; staleBefore: string };
  summary: Summary | null;
  staleJobs: StaleJob[];
  reconciliation: Reconciliation[];
  violations: Violations | null;
};

type RecoveryAction = "complete_from_private_cache" | "mark_uncertain";

const numberValue = (value: number | null | undefined) => Number(value ?? 0);
const formatCost = (value: number | null | undefined) => `$${numberValue(value).toFixed(4)}`;
const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });

export default function ByokHealthPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/byok-health", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "BYOK 运行数据不可用");
      setHealth(body as Health);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "BYOK 运行数据不可用");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const violationTotal = useMemo(() => health?.violations
    ? Object.values(health.violations).reduce((sum, value) => sum + numberValue(value), 0)
    : 0, [health]);

  const recover = async (job: StaleJob, action: RecoveryAction) => {
    const label = action === "complete_from_private_cache"
      ? "仅依据私有缓存与成本证据完成任务"
      : "将任务标记为 PROVIDER_OUTCOME_UNCERTAIN";
    if (!window.confirm(`${label}？\n\nJob: ${job.job_id}\nOwner: ${job.owner_id}\n\n此操作不会重新调用 Provider。`)) return;
    setRecovering(job.job_id);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/byok-health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          expectedUpdatedAt: job.updated_at,
          jobId: job.job_id,
          ownerId: job.owner_id,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`${body?.code || "RECOVERY_REJECTED"}: ${body?.error || "操作被拒绝"}`);
      setNotice(`Job ${job.job_id} 已完成受控对账：${body.status}`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "受控对账失败");
    } finally {
      setRecovering(null);
    }
  };

  if (loading && !health) return <div className="py-10 text-center text-muted-foreground">正在加载 BYOK 运行状态…</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold"><ShieldCheck className="h-6 w-6 text-primary" />BYOK 运行与对账</h2>
          <p className="mt-1 text-sm text-muted-foreground">只读观测默认安全；恢复操作必须逐条确认，且绝不重放 Provider 请求。</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Live Mode 默认关闭</span>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />刷新
          </Button>
        </div>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="连接 / 已验证" value={`${numberValue(health?.summary?.verified_connection_count)} / ${numberValue(health?.summary?.connection_count)}`} />
        <Stat label="24h BYOK Jobs" value={numberValue(health?.summary?.byok_jobs_24h)} />
        <Stat label="24h 完成 / 部分成功" value={`${numberValue(health?.summary?.completed_jobs_24h)} / ${numberValue(health?.summary?.partial_compare_jobs_24h)}`} />
        <Stat label="24h 失败 / Stale" value={`${numberValue(health?.summary?.failed_jobs_24h)} / ${numberValue(health?.summary?.stale_started_jobs)}`} warning={numberValue(health?.summary?.stale_started_jobs) > 0} />
        <Stat label="24h 报价估算" value={formatCost(health?.summary?.committed_estimate_usd_24h)} />
        <Stat label="24h 已记账成本" value={formatCost(health?.summary?.accounted_cost_usd_24h)} />
        <Stat label="隔离/账本违规" value={violationTotal} warning={violationTotal > 0} />
        <Stat label="最后生成" value={health ? formatTime(health.generatedAt) : "-"} compact />
      </section>

      <section className="rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2">
          {violationTotal === 0 ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
          <h3 className="font-semibold">隔离与账本守卫</h3>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Guard label="归因不匹配" value={health?.violations?.attribution_mismatch_count} />
          <Guard label="Shared Cache 违规" value={health?.violations?.shared_cache_violation_count} />
          <Guard label="孤立已提交报价" value={health?.violations?.orphan_committed_quote_count} />
          <Guard label="缺失成本事件" value={health?.violations?.missing_cost_event_count} />
          <Guard label="缺失 Event Key" value={health?.violations?.missing_event_key_count} />
        </div>
      </section>

      <section className="space-y-3">
        <div><h3 className="text-lg font-semibold">Stale Provider Checkpoints</h3><p className="text-sm text-muted-foreground">超过 5 分钟仍停留在 processing/started 的任务；任何恢复都需要精确匹配当前 updated_at。</p></div>
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card shadow-sm">
          <table className="w-full min-w-[980px] text-sm">
            <thead><tr className="border-b bg-muted/40"><th className="px-4 py-3 text-left">Job / Owner</th><th className="px-4 py-3 text-left">能力</th><th className="px-4 py-3 text-left">Connection</th><th className="px-4 py-3 text-left">成本证据</th><th className="px-4 py-3 text-left">更新时间</th><th className="px-4 py-3 text-right">受控操作</th></tr></thead>
            <tbody>{!health?.staleJobs.length ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">当前没有 stale BYOK 任务</td></tr> : health.staleJobs.map((job) => (
              <tr key={job.job_id} className="border-b last:border-b-0">
                <td className="px-4 py-3"><div className="font-mono text-xs">{job.job_id}</div><div className="mt-1 font-mono text-xs text-muted-foreground">{job.owner_id}</div></td>
                <td className="px-4 py-3 font-medium">{job.job_type}</td>
                <td className="px-4 py-3"><div className="font-mono text-xs">{job.provider_connection_id || "-"}</div><div className="text-xs text-muted-foreground">v{job.provider_connection_version ?? "-"}</div></td>
                <td className="px-4 py-3">{job.cost_event_count} / {formatCost(job.accounted_cost_usd)}</td>
                <td className="whitespace-nowrap px-4 py-3">{formatTime(job.updated_at)}</td>
                <td className="px-4 py-3"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={recovering === job.job_id} onClick={() => void recover(job, "complete_from_private_cache")}>从私有缓存完成</Button><Button size="sm" variant="destructive" disabled={recovering === job.job_id} onClick={() => void recover(job, "mark_uncertain")}>标记不确定</Button></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div><h3 className="text-lg font-semibold">最近 7 天成本对账</h3><p className="text-sm text-muted-foreground">估算高于实记为保守报价；缺失证据、超估算或孤立报价需要人工检查。</p></div>
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-card shadow-sm">
          <table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b bg-muted/40"><th className="px-4 py-3 text-left">时间</th><th className="px-4 py-3 text-left">能力</th><th className="px-4 py-3 text-left">状态</th><th className="px-4 py-3 text-right">估算</th><th className="px-4 py-3 text-right">实记</th><th className="px-4 py-3 text-right">差额</th></tr></thead>
            <tbody>{!health?.reconciliation.length ? <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">暂无已提交 BYOK 报价</td></tr> : health.reconciliation.map((item) => <tr key={item.quote_id} className="border-b last:border-b-0"><td className="whitespace-nowrap px-4 py-3">{formatTime(item.created_at)}</td><td className="px-4 py-3">{item.capability}</td><td className="px-4 py-3"><Status value={item.status} /></td><td className="px-4 py-3 text-right">{formatCost(item.estimated_cost_usd)}</td><td className="px-4 py-3 text-right">{formatCost(item.accounted_cost_usd)}</td><td className="px-4 py-3 text-right">{formatCost(item.varianceUsd)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, warning = false, compact = false }: { label: string; value: string | number; warning?: boolean; compact?: boolean }) {
  return <div className={`rounded-xl border p-4 ${warning ? "border-amber-200 bg-amber-50" : "border-border/70 bg-card"}`}><div className="text-sm text-muted-foreground">{label}</div><div className={`mt-1 font-semibold ${compact ? "text-sm" : "text-2xl"} ${warning ? "text-amber-700" : ""}`}>{value}</div></div>;
}

function Guard({ label, value }: { label: string; value: number | null | undefined }) {
  const count = numberValue(value);
  return <div className={`rounded-lg border px-3 py-3 ${count ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-xl font-semibold ${count ? "text-amber-700" : "text-emerald-700"}`}>{count}</div></div>;
}

function Status({ value }: { value: string }) {
  const safe = value === "accounted" || value === "under_estimate";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${safe ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{value}</span>;
}
