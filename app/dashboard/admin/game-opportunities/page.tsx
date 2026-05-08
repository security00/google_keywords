"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbulb, RefreshCw } from "lucide-react";

type OpportunityItem = {
  id: string;
  keyword: string;
  sourceSite: string | null;
  recommendation: string;
  trendRatio: number;
  trendSlope: number;
  serpAuth: number | null;
  reason: string | null;
  checkedAt: string;
  priorityScore: number;
  whyWorthDoing: string;
  intent: string;
  contentAngle: string;
  risk: string;
  format: string;
};

type Payload = {
  limit: number;
  summary: {
    totalCandidates: number;
    topCount: number;
  };
  items: OpportunityItem[];
};

const num = (value: number | null | undefined) => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "-";
const date = (value: string) => value ? new Date(value).toLocaleString("zh-CN") : "-";

export default function GameOpportunitiesPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/game-opportunity-enrichment?limit=${limit}`, { cache: "no-store" });
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
          <Lightbulb className="h-6 w-6 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold">新游机会富集</h1>
            <p className="text-sm text-muted-foreground">
              只读预览 Top N 推荐候选的内容机会：不写库、不调用外部付费 API、不改变学生端推荐结果。
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

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Top N" value={payload?.limit ?? limit} />
        <StatCard label="返回候选" value={payload?.summary.topCount ?? 0} />
        <StatCard label="候选池" value={payload?.summary.totalCandidates ?? 0} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">机会富集预览</h2>
          <p className="text-xs text-muted-foreground">v1 使用现有 pipeline 字段确定性生成，后续再考虑对 Top N 做 LLM brief。</p>
        </div>
        <div className="divide-y">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : payload?.items.length ? (
            payload.items.map((item) => (
              <article key={item.id} className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{item.keyword}</h3>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.sourceSite || "unknown"} · {item.recommendation} · score {num(item.priorityScore)} · checked {date(item.checkedAt)}
                    </div>
                  </div>
                  <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">{item.format}</div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <InfoBlock title="为什么值得做" text={item.whyWorthDoing} />
                  <InfoBlock title="搜索意图" text={item.intent} />
                  <InfoBlock title="内容角度" text={item.contentAngle} />
                  <InfoBlock title="风险" text={item.risk} />
                </div>

                <div className="rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  trend_ratio {num(item.trendRatio)} · trend_slope {num(item.trendSlope)} · serp_auth {item.serpAuth ?? "-"}
                  {item.reason ? ` · ${item.reason}` : ""}
                </div>
              </article>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">当前没有非 skip 推荐候选可富集</div>
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

function InfoBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded bg-muted/40 p-3">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      <div className="text-sm">{text}</div>
    </div>
  );
}
