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

type Feedback = {
  opportunityId: string;
  keyword: string;
  verdict: "worth_doing" | "not_worth_doing";
  note: string | null;
  updatedAt: string;
};

const num = (value: number | null | undefined) => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "-";
const date = (value: string) => value ? new Date(value).toLocaleString("zh-CN") : "-";

export default function GameOpportunitiesPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [feedbackById, setFeedbackById] = useState<Record<string, Feedback>>({});
  const [noteDraftById, setNoteDraftById] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [previewRes, feedbackRes] = await Promise.all([
        fetch(`/api/admin/game-opportunity-enrichment?limit=${limit}`, { cache: "no-store" }),
        fetch("/api/admin/game-opportunity-feedback", { cache: "no-store" }),
      ]);
      const data = await previewRes.json();
      const feedbackData = await feedbackRes.json();
      if (!previewRes.ok) throw new Error(data?.error || "加载失败");
      if (!feedbackRes.ok) throw new Error(feedbackData?.error || "反馈加载失败");
      const feedbackList = (feedbackData.feedback || []) as Feedback[];
      setPayload(data);
      setFeedbackById(Object.fromEntries(feedbackList.map((item) => [item.opportunityId, item])));
      setNoteDraftById(Object.fromEntries(feedbackList.map((item) => [item.opportunityId, item.note || ""])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const saveFeedback = async (item: OpportunityItem, verdict: "worth_doing" | "not_worth_doing") => {
    setSavingId(item.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/game-opportunity-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: item.id,
          keyword: item.keyword,
          verdict,
          note: noteDraftById[item.id] || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存失败");
      setFeedbackById((current) => ({
        ...current,
        [item.id]: {
          opportunityId: item.id,
          keyword: item.keyword,
          verdict,
          note: noteDraftById[item.id]?.trim() || null,
          updatedAt: new Date().toISOString(),
        },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingId(null);
    }
  };

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
              富集预览不写 pipeline、不调用外部付费 API、不改变学生端推荐结果；人工反馈只写独立侧表。
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
            payload.items.map((item) => {
              const feedback = feedbackById[item.id];
              return (
              <article key={item.id} className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold">{item.keyword}</h3>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.sourceSite || "unknown"} · {item.recommendation} · score {num(item.priorityScore)} · checked {date(item.checkedAt)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {feedback && (
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${feedback.verdict === "worth_doing" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                        {feedback.verdict === "worth_doing" ? "已标记：值得做" : "已标记：不值得做"}
                      </span>
                    )}
                    <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">{item.format}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <InfoBlock title="为什么值得做" text={item.whyWorthDoing} />
                  <InfoBlock title="搜索意图" text={item.intent} />
                  <InfoBlock title="内容角度" text={item.contentAngle} />
                  <InfoBlock title="风险" text={item.risk} />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    trend_ratio {num(item.trendRatio)} · trend_slope {num(item.trendSlope)} · serp_auth {item.serpAuth ?? "-"}
                    {item.reason ? ` · ${item.reason}` : ""}
                  </span>
                  <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                    <input
                      value={noteDraftById[item.id] ?? feedback?.note ?? ""}
                      onChange={(event) => setNoteDraftById((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder="备注：为什么值得 / 不值得"
                      maxLength={500}
                      className="h-8 min-w-52 rounded border bg-background px-2 text-xs text-foreground"
                    />
                    <button
                      onClick={() => saveFeedback(item, "worth_doing")}
                      disabled={savingId === item.id}
                      className="rounded border border-emerald-200 px-2 py-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      ✅ 值得做
                    </button>
                    <button
                      onClick={() => saveFeedback(item, "not_worth_doing")}
                      disabled={savingId === item.id}
                      className="rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      ❌ 不值得
                    </button>
                  </div>
                </div>
              </article>
              );
            })
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
