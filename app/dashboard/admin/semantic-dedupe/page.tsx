"use client";

import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, RefreshCw } from "lucide-react";

type Variant = {
  id: string;
  keyword: string;
  score: number;
  extractedAt: string;
};

type SemanticGroup = {
  semanticKey: string;
  representative: Variant;
  variants: Variant[];
  confidence: "high" | "medium";
  reason: string;
};

type PreviewPayload = {
  strategy: "recent" | "priority";
  maxItems: number;
  summary: {
    availableCount: number;
    exactDedupedCount: number;
    semanticGroupCount: number;
    estimatedFoldedCount: number;
  };
  groups: SemanticGroup[];
};

type Feedback = {
  semanticKey: string;
  verdict: "merge" | "separate";
  representativeKeyword: string;
  variants: string[];
  note: string | null;
  updatedAt: string;
};

const date = (value: string) => value ? new Date(value).toLocaleString("zh-CN") : "-";
const num = (value: number) => Number.isFinite(value) ? value.toFixed(1) : "-";

export default function SemanticDedupePage() {
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [strategy, setStrategy] = useState<"recent" | "priority">("priority");
  const [maxItems, setMaxItems] = useState(120);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [feedbackByKey, setFeedbackByKey] = useState<Record<string, Feedback>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ strategy, maxItems: String(maxItems) });
      const [previewRes, feedbackRes] = await Promise.all([
        fetch(`/api/admin/semantic-dedupe-preview?${params.toString()}`, { cache: "no-store" }),
        fetch("/api/admin/semantic-dedupe-feedback", { cache: "no-store" }),
      ]);
      const data = await previewRes.json();
      const feedbackData = await feedbackRes.json();
      if (!previewRes.ok) throw new Error(data?.error || "加载失败");
      if (!feedbackRes.ok) throw new Error(feedbackData?.error || "反馈加载失败");
      setPayload(data);
      setFeedbackByKey(Object.fromEntries((feedbackData.feedback || []).map((item: Feedback) => [item.semanticKey, item])));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [strategy, maxItems]);

  useEffect(() => {
    load();
  }, [load]);

  const saveFeedback = async (group: SemanticGroup, verdict: "merge" | "separate") => {
    setSavingKey(group.semanticKey);
    setError(null);
    try {
      const res = await fetch("/api/admin/semantic-dedupe-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          semanticKey: group.semanticKey,
          verdict,
          representativeKeyword: group.representative.keyword,
          variants: group.variants.map((item) => item.keyword),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存失败");
      setFeedbackByKey((current) => ({
        ...current,
        [group.semanticKey]: {
          semanticKey: group.semanticKey,
          verdict,
          representativeKeyword: group.representative.keyword,
          variants: group.variants.map((item) => item.keyword),
          note: null,
          updatedAt: new Date().toISOString(),
        },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingKey(null);
    }
  };

  const summary = payload?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrainCircuit className="h-6 w-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold">语义去重预览</h1>
            <p className="text-sm text-muted-foreground">
              只读预览候选词中的近似重复，不写库、不改变 compare 选择结果、不影响学生端。
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as "recent" | "priority")}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="priority">优先级池</option>
            <option value="recent">最近候选</option>
          </select>
          <input
            type="number"
            min={10}
            max={400}
            value={maxItems}
            onChange={(event) => setMaxItems(Number(event.target.value) || 120)}
            className="h-9 w-24 rounded-md border bg-background px-3 text-sm"
          />
          <button onClick={load} className="rounded-md border p-2 hover:bg-muted" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="可用候选" value={summary?.availableCount ?? 0} />
        <StatCard label="精确去重后" value={summary?.exactDedupedCount ?? 0} />
        <StatCard label="语义重复组" value={summary?.semanticGroupCount ?? 0} />
        <StatCard label="预计可折叠" value={summary?.estimatedFoldedCount ?? 0} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">重复组预览</h2>
          <p className="text-xs text-muted-foreground">这里只展示 variants，不会自动删除或替换任何候选词。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <Th>语义 Key</Th>
                <Th>代表词</Th>
                <Th align="right">变体数</Th>
                <Th>置信度</Th>
                <Th>变体</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
              ) : payload?.groups.length ? (
                payload.groups.map((group) => {
                  const feedback = feedbackByKey[group.semanticKey];
                  return (
                  <tr key={group.semanticKey} className="border-t align-top hover:bg-muted/30">
                    <Td className="font-mono text-xs">
                      <div>{group.semanticKey}</div>
                      {feedback && (
                        <div className={`mt-2 inline-flex rounded px-2 py-0.5 text-[11px] ${feedback.verdict === "merge" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {feedback.verdict === "merge" ? "已标记：合并合理" : "已标记：不该合并"}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <div className="font-medium">{group.representative.keyword}</div>
                      <div className="text-xs text-muted-foreground">score {num(group.representative.score)} · {date(group.representative.extractedAt)}</div>
                    </Td>
                    <Td align="right">{group.variants.length}</Td>
                    <Td>{group.confidence === "high" ? "高" : "中"}</Td>
                    <Td>
                      <div className="space-y-2">
                        <div className="space-y-1">
                          {group.variants.map((variant) => (
                            <div key={variant.id} className="rounded bg-muted/40 px-2 py-1">
                              <span className="font-medium">{variant.keyword}</span>
                              <span className="ml-2 text-xs text-muted-foreground">score {num(variant.score)} · {date(variant.extractedAt)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => saveFeedback(group, "merge")}
                            disabled={savingKey === group.semanticKey}
                            className="rounded border border-green-200 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-50"
                          >
                            ✅ 合并合理
                          </button>
                          <button
                            type="button"
                            onClick={() => saveFeedback(group, "separate")}
                            disabled={savingKey === group.semanticKey}
                            className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            ❌ 不该合并
                          </button>
                        </div>
                      </div>
                    </Td>
                  </tr>
                  );
                })
              ) : (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">当前候选池没有发现可折叠语义重复组</td></tr>
              )}
            </tbody>
          </table>
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

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-3 text-${align} font-medium`}>{children}</th>;
}

function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-4 py-3 text-${align} ${className}`}>{children}</td>;
}
