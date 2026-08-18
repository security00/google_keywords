"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

type FunnelSnapshot = {
  generatedAt: string;
  registeredStudents: number;
  pendingActivation: number;
  activatedTrials: number;
  activeTrials: number;
  expiredTrials: number;
  subscribed: number;
  invitedActivated: number;
  last7dRegistrations: number;
  last30dRegistrations: number;
};

const stages = [
  { key: "registeredStudents", label: "注册" },
  { key: "activatedTrials", label: "已开通试用" },
  { key: "expiredTrials", label: "试用已到期" },
  { key: "subscribed", label: "已订阅" },
] as const;

export default function AdminSaasFunnelPage() {
  const [snapshot, setSnapshot] = useState<FunnelSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/saas-funnel", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "无法读取漏斗");
      }
      setSnapshot(payload as FunnelSnapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取漏斗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">SaaS 漏斗</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            只读计数：注册 → 试用 → 到期 → 订阅。不创建用户，也不触发 Provider。
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((stage) => (
          <div key={stage.key} className="rounded-lg border bg-card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {stage.label}
            </div>
            <div className="mt-2 text-3xl font-semibold">
              {snapshot ? snapshot[stage.key] : loading ? "…" : "-"}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="进行中试用" value={snapshot?.activeTrials} loading={loading} />
        <Metric label="待人工开通" value={snapshot?.pendingActivation} loading={loading} />
        <Metric label="邀请码开通" value={snapshot?.invitedActivated} loading={loading} />
        <Metric label="近 7 天注册" value={snapshot?.last7dRegistrations} loading={loading} />
        <Metric label="近 30 天注册" value={snapshot?.last30dRegistrations} loading={loading} />
        <Metric
          label="快照时间"
          value={
            snapshot?.generatedAt
              ? new Date(snapshot.generatedAt).toLocaleString("zh-CN", { hour12: false })
              : undefined
          }
          loading={loading}
        />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  loading,
}: {
  label: string;
  value?: number | string;
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold">
        {value === undefined ? (loading ? "…" : "-") : value}
      </div>
    </div>
  );
}
