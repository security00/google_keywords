"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";

type SourceScoreRow = {
  sourceSite: string;
  totalChecked: number;
  recommendedCount: number;
  snr: number;
  worthCount: number;
  notWorthCount: number;
  feedbackCount: number;
  feedbackScore: number;
  sourceScore: number;
  confidence: "low" | "medium" | "high";
  lastCheckedAt: string | null;
};

type SourceScorePayload = {
  summary: {
    sourceCount: number;
    bestSource: string | null;
    averageScore: number;
  };
  sources: SourceScoreRow[];
};

const pct = (value: number) => `${Math.round(value * 100)}%`;
const num = (value: number) => Number.isFinite(value) ? value.toFixed(1) : "-";
const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "-";

const confidenceLabel = (value: SourceScoreRow["confidence"]) => {
  if (value === "high") return "高可信";
  if (value === "medium") return "中可信";
  return "低可信";
};

export default function SourceScorePage() {
  const [payload, setPayload] = useState<SourceScorePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/source-score", { cache: "no-store" });
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
          <Gauge className="h-6 w-6 text-cyan-500" />
          <div>
            <h1 className="text-2xl font-bold">Source Score</h1>
            <p className="text-sm text-muted-foreground">
              只读聚合信号源 SNR、推荐量和人工反馈；用于观察，不自动改权重、不影响学生端推荐。
            </p>
          </div>
        </div>
        <button onClick={load} className="rounded-md border p-2 hover:bg-muted" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="来源数" value={payload?.summary.sourceCount ?? 0} />
        <StatCard label="当前最佳" value={payload?.summary.bestSource ?? "-"} />
        <StatCard label="平均分" value={num(payload?.summary.averageScore ?? 0)} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">来源评分</h2>
          <p className="text-xs text-muted-foreground">
            评分 = SNR + 推荐量 + 人工反馈倾向。可信度低时只作为观察，不用于自动调权。
          </p>
        </div>
        <div className="divide-y">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : payload?.sources.length ? (
            payload.sources.map((source) => (
              <div key={source.sourceSite} className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{source.sourceSite}</h3>
                    <p className="text-xs text-muted-foreground">last checked: {date(source.lastCheckedAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-medium text-cyan-700">
                      Score {num(source.sourceScore)}
                    </span>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                      {confidenceLabel(source.confidence)}
                    </span>
                  </div>
                </div>

                <div className="grid gap-3 text-sm md:grid-cols-4">
                  <Metric label="扫描" value={source.totalChecked} />
                  <Metric label="推荐" value={source.recommendedCount} />
                  <Metric label="SNR" value={pct(source.snr)} />
                  <Metric label="反馈" value={`✅${source.worthCount} / ❌${source.notWorthCount}`} />
                </div>

                <div className="text-xs text-muted-foreground">
                  feedback score {num(source.feedbackScore)} · feedback count {source.feedbackCount}
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无来源评分数据</div>
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
