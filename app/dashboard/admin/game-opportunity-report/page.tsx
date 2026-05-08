"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";

type Feedback = {
  opportunityId: string;
  keyword: string;
  verdict: "worth_doing" | "not_worth_doing";
  note: string | null;
  updatedAt: string;
};

type ReportItem = {
  id: string;
  keyword: string;
  sourceSite: string | null;
  recommendation: string;
  priorityScore: number;
  whyWorthDoing: string;
  intent: string;
  contentAngle: string;
  risk: string;
  feedback: Feedback | null;
};

type SourceRow = {
  source_site: string;
  total_checked: number;
  recommended_count: number;
  snr: number;
  last_checked_at: string | null;
};

type ReportPayload = {
  limit: number;
  generatedAt: string;
  summary: {
    totalCandidates: number;
    topCount: number;
    worthDoingCount: number;
    notWorthDoingCount: number;
    sourceCount: number;
    totalChecked: number;
    totalRecommended: number;
    overallSnr: number;
    bestSource: string | null;
  };
  items: ReportItem[];
  topSources: SourceRow[];
};

const pct = (value: number) => `${Math.round(value * 100)}%`;
const num = (value: number) => Number.isFinite(value) ? value.toFixed(1) : "-";
const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "-";

export default function GameOpportunityReportPage() {
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/game-opportunity-report?limit=${limit}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "加载失败");
      setPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold">新游机会日报</h1>
            <p className="text-sm text-muted-foreground">
              只读聚合 Top N 机会、人工反馈和信号源质量；不写库、不调用外部付费 API、不改变推荐结果。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={50}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value) || 10)}
            className="h-9 w-24 rounded-md border bg-background px-3 text-sm"
          />
          <button onClick={load} className="rounded-md border p-2 hover:bg-muted" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Top 机会" value={payload?.summary.topCount ?? 0} />
        <StatCard label="值得做" value={payload?.summary.worthDoingCount ?? 0} />
        <StatCard label="不值得" value={payload?.summary.notWorthDoingCount ?? 0} />
        <StatCard label="整体 SNR" value={payload ? pct(payload.summary.overallSnr) : "0%"} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">今日机会清单</h2>
          <p className="text-xs text-muted-foreground">生成时间：{date(payload?.generatedAt || null)}</p>
        </div>
        <div className="divide-y">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : payload?.items.length ? (
            payload.items.map((item, index) => (
              <article key={item.id} className="space-y-2 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">#{index + 1} {item.keyword}</h3>
                    <p className="text-xs text-muted-foreground">
                      {item.sourceSite || "unknown"} · {item.recommendation} · score {num(item.priorityScore)} · {item.intent}
                    </p>
                  </div>
                  {item.feedback && (
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${item.feedback.verdict === "worth_doing" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      {item.feedback.verdict === "worth_doing" ? "值得做" : "不值得"}
                    </span>
                  )}
                </div>
                <p className="text-sm">{item.whyWorthDoing}</p>
                <p className="text-sm text-muted-foreground">角度：{item.contentAngle}</p>
                <p className="text-sm text-muted-foreground">风险：{item.risk}</p>
                {item.feedback?.note && <p className="rounded bg-muted/40 px-3 py-2 text-xs">反馈备注：{item.feedback.note}</p>}
              </article>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无可汇总的新游机会</div>
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">来源质量摘要</h2>
          <p className="text-xs text-muted-foreground">推荐数和 SNR 仅用于观察，不自动改权重。</p>
        </div>
        <div className="divide-y">
          {(payload?.topSources || []).map((source) => (
            <div key={source.source_site} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{source.source_site}</div>
                <div className="text-xs text-muted-foreground">last checked: {date(source.last_checked_at)}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                checked {source.total_checked} · recommended {source.recommended_count} · SNR {pct(source.snr)}
              </div>
            </div>
          ))}
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
