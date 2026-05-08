"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal, RefreshCw } from "lucide-react";

type Action = "boost" | "downrank" | "watch";

type Suggestion = {
  sourceSite: string;
  action: Action;
  suggestedMultiplier: number;
  reason: string;
  worthRate: number | null;
  notWorthRate: number | null;
  feedbackCount: number;
  sourceScore: number;
  confidence: "low" | "medium" | "high";
  canAutoApply: false;
};

type Payload = {
  summary: {
    boostCount: number;
    downrankCount: number;
    watchCount: number;
    total: number;
  };
  suggestions: Suggestion[];
};

const pct = (value: number | null) => value === null ? "-" : `${Math.round(value * 100)}%`;
const num = (value: number) => Number.isFinite(value) ? value.toFixed(1) : "-";

const actionLabel = (action: Action) => {
  if (action === "boost") return "建议升权";
  if (action === "downrank") return "建议降权";
  return "继续观察";
};

const actionClass = (action: Action) => {
  if (action === "boost") return "bg-emerald-100 text-emerald-700";
  if (action === "downrank") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
};

export default function SourceWeightSuggestionsPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/source-weight-suggestions", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "加载失败");
      setPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SlidersHorizontal className="h-6 w-6 text-violet-500" />
          <div>
            <h1 className="text-2xl font-bold">来源调权建议</h1>
            <p className="text-sm text-muted-foreground">
              根据 Source Score 和人工反馈生成只读建议；不会自动写权重、不会训练模型、不会改变推荐结果。
            </p>
          </div>
        </div>
        <button onClick={load} className="rounded-md border p-2 hover:bg-muted" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="总来源" value={payload?.summary.total ?? 0} />
        <StatCard label="建议升权" value={payload?.summary.boostCount ?? 0} />
        <StatCard label="建议降权" value={payload?.summary.downrankCount ?? 0} />
        <StatCard label="继续观察" value={payload?.summary.watchCount ?? 0} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">建议列表</h2>
          <p className="text-xs text-muted-foreground">
            当前规则：反馈数 ≥ 5 且值得率 ≥ 70% 建议升权；反馈数 ≥ 5 且不值得率 ≥ 60% 建议降权；否则观察。
          </p>
        </div>
        <div className="divide-y">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : payload?.suggestions.length ? (
            payload.suggestions.map((item) => (
              <article key={item.sourceSite} className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{item.sourceSite}</h3>
                    <p className="text-xs text-muted-foreground">{item.reason}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${actionClass(item.action)}`}>
                      {actionLabel(item.action)} ×{item.suggestedMultiplier}
                    </span>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                      不自动应用
                    </span>
                  </div>
                </div>
                <div className="grid gap-3 text-sm md:grid-cols-5">
                  <Metric label="Source Score" value={num(item.sourceScore)} />
                  <Metric label="值得率" value={pct(item.worthRate)} />
                  <Metric label="不值得率" value={pct(item.notWorthRate)} />
                  <Metric label="反馈数" value={item.feedbackCount} />
                  <Metric label="可信度" value={item.confidence} />
                </div>
              </article>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无调权建议</div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded bg-muted/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
