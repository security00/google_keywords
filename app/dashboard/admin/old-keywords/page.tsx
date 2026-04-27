"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

type OldKeyword = {
  keyword: string;
  source_seed: string;
  volume: number;
  cpc: number;
  kd: number;
  competition: string;
  intent: string;
  toolable: number;
  score: number;
  scan_date: string;
  trend_series: string | null;
  real_score: number | null;
  base_score: number | null;
  serp_score: number | null;
  brand_safety_score: number | null;
  intent_score: number | null;
  content_feasibility_score: number | null;
  serp_organic: number | null;
  serp_auth: number | null;
  serp_featured: number | null;
  serp_ai_overview: number | null;
  top_domains: string[] | null;
  evaluated_at: string | null;
};

const PAGE_SIZE = 20;

type EvaluationResult = {
  evaluated: number;
  skippedExisting: number;
  topCandidateCount: number;
  actualCostUsd: number;
  estimatedCostUsd: number;
  pipelineRunId?: string;
  force: boolean;
  message?: string;
};

function parseSeries(raw: string | null): {
  keyword: Array<{ date: string; value: number }>;
  benchmark: Array<{ date: string; value: number }>;
} {
  if (!raw) return { keyword: [], benchmark: [] };
  try {
    const parsed = JSON.parse(raw);
    // New format: { keyword: [...], benchmark: [...] }
    if (parsed.keyword && Array.isArray(parsed.keyword)) {
      return {
        keyword: parsed.keyword.map((p: { date?: string; value?: number }) => ({
          date: (p.date || "").slice(5, 10),
          value: Number(p.value || 0),
        })),
        benchmark: (parsed.benchmark || []).map((p: { date?: string; value?: number }) => ({
          date: (p.date || "").slice(5, 10),
          value: Number(p.value || 0),
        })),
      };
    }
    // Legacy format: plain array
    if (Array.isArray(parsed)) {
      return {
        keyword: parsed.map((p: { date?: string; value?: number }) => ({
          date: (p.date || "").slice(5, 10),
          value: Number(p.value || 0),
        })),
        benchmark: [],
      };
    }
    return { keyword: [], benchmark: [] };
  } catch { return { keyword: [], benchmark: [] }; }
}

function TrendChart({ data }: { data: ReturnType<typeof parseSeries> }) {
  const { keyword, benchmark } = data;
  if (keyword.length === 0) return <span className="text-xs text-muted-foreground">无趋势数据</span>;
  // Merge by date for dual-line chart
  const dateMap = new Map<string, { date: string; kw: number; bm: number }>();
  for (const p of keyword) dateMap.set(p.date, { date: p.date, kw: p.value, bm: 0 });
  for (const p of benchmark) {
    const entry = dateMap.get(p.date);
    if (entry) entry.bm = p.value;
  }
  const chartData = Array.from(dateMap.values());
  return (
    <div className="w-full h-[180px] mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={30} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="kw" name="关键词" stroke="#6366f1" strokeWidth={2} dot={false} />
          {benchmark.length > 0 && (
            <Line type="monotone" dataKey="bm" name="Benchmark (gpts)" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function kdColor(kd: number) {
  if (kd <= 15) return "text-green-600 dark:text-green-400";
  if (kd <= 35) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function compBadge(comp: string) {
  if (comp === "LOW") return <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">LOW</span>;
  if (comp === "MEDIUM") return <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">MEDIUM</span>;
  return <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{comp || "-"}</span>;
}

function formatScore(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : Number(value).toFixed(1);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function KeywordRow({ kw, globalIdx, isExpanded, onToggle }: {
  kw: OldKeyword; globalIdx: number; isExpanded: boolean; onToggle: () => void;
}) {
  const data = useMemo(() => parseSeries(kw.trend_series), [kw.trend_series]);
  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className="grid grid-cols-[40px_1fr_90px_70px_50px_70px_70px_80px_80px] items-center px-3 py-2.5 cursor-pointer hover:bg-muted/30 text-sm gap-1"
        onClick={onToggle}
      >
        <span className="text-muted-foreground">{globalIdx + 1}</span>
        <span className="font-medium truncate">{kw.keyword}</span>
        <span className="text-right">{kw.volume.toLocaleString()}</span>
        <span className="text-right">${kw.cpc.toFixed(2)}</span>
        <span className={`text-right font-medium ${kdColor(kw.kd)}`}>{kw.kd}</span>
        <span className="text-center">{compBadge(kw.competition)}</span>
        <span className="text-center text-xs text-muted-foreground">{kw.intent}</span>
        <span className="text-right font-medium text-muted-foreground">{kw.score.toLocaleString()}</span>
        <span className="text-right font-bold text-indigo-600 dark:text-indigo-400">{formatScore(kw.real_score)}</span>
      </div>
      {isExpanded && (
        <div className="px-4 pb-3 pt-1 border-t bg-muted/10">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-1">
            <span>来源: {kw.source_seed}</span>
            <span>月搜索量: {kw.volume.toLocaleString()}</span>
            <span>CPC: ${kw.cpc.toFixed(2)}</span>
            <span>KD: {kw.kd}</span>
            <span>真实分: {formatScore(kw.real_score)}</span>
            <span>SERP: {formatScore(kw.serp_score)}</span>
            <span>品牌安全: {formatScore(kw.brand_safety_score)}</span>
            <span>意图: {formatScore(kw.intent_score)}</span>
            <span>内容可做: {formatScore(kw.content_feasibility_score)}</span>
            {kw.evaluated_at && <span>评估: {formatDate(kw.evaluated_at)}</span>}
          </div>
          {kw.real_score !== null && (
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>自然结果: {kw.serp_organic ?? 0}</span>
              <span>权威域名: {kw.serp_auth ?? 0}</span>
              <span>精选摘要: {kw.serp_featured ? "有" : "无"}</span>
              <span>AI Overview: {kw.serp_ai_overview ? "有" : "无"}</span>
              {kw.top_domains?.length ? <span>Top domains: {kw.top_domains.slice(0, 5).join(", ")}</span> : null}
            </div>
          )}
          <TrendChart data={data} />
        </div>
      )}
    </div>
  );
}

function KeywordHeader() {
  return (
    <div className="grid grid-cols-[40px_1fr_90px_70px_50px_70px_70px_80px_80px] items-center px-3 text-xs font-medium text-muted-foreground gap-1">
      <span>#</span>
      <span>关键词</span>
      <span className="text-right">月搜索量</span>
      <span className="text-right">CPC</span>
      <span className="text-right">KD</span>
      <span className="text-center">竞争</span>
      <span className="text-center">意图</span>
      <span className="text-right">初筛分</span>
      <span className="text-right">真实分</span>
    </div>
  );
}

export default function OldKeywordsPage() {
  const [keywords, setKeywords] = useState<OldKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [page, setPage] = useState(1);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);
  const [evaluating, setEvaluating] = useState(false);
  const [lastEvaluation, setLastEvaluation] = useState<EvaluationResult | null>(null);

  const fetchKeywords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/old-keywords?limit=500&minScore=${minScore}`);
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      setKeywords(data.keywords || []);
      setPage(1);
      setExpandedIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, [minScore]);

  const runEvaluation = useCallback(async (force = false) => {
    const ok = window.confirm(
      force
        ? "将强制重跑当前最新批次 Top80 的 DataForSEO SERP 真实评分，已有评分也会重新计费。是否继续？"
        : "将为当前最新批次 Top80 中尚未评分的词调用 DataForSEO SERP，已有评分会跳过。是否继续？"
    );
    if (!ok) return;

    setEvaluating(true);
    setError("");
    try {
      const response = await fetch("/api/admin/old-keywords/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ limit: 80, minScore, force }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "真实评分失败");
      const result: EvaluationResult = {
        evaluated: Number(data.evaluated || 0),
        skippedExisting: Number(data.skippedExisting || 0),
        topCandidateCount: Number(data.topCandidateCount || 0),
        actualCostUsd: Number(data.actualCostUsd || 0),
        estimatedCostUsd: Number(data.estimatedCostUsd || 0),
        pipelineRunId: typeof data.pipelineRunId === "string" ? data.pipelineRunId : undefined,
        force,
        message: typeof data.message === "string" ? data.message : undefined,
      };
      setLastEvaluation(result);
      window.alert(
        `真实评分完成：${result.evaluated} 个词，跳过 ${result.skippedExisting} 个已评分，成本 $${result.actualCostUsd.toFixed(4)}${
          result.pipelineRunId ? `，管线 ${result.pipelineRunId}` : result.message ? `，${result.message}` : ""
        }`
      );
      await fetchKeywords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "真实评分失败");
    } finally {
      setEvaluating(false);
    }
  }, [fetchKeywords, minScore]);

  useEffect(() => { fetchKeywords(); }, [fetchKeywords]);

  const totalPages = Math.ceil(keywords.length / PAGE_SIZE);
  const pageKeywords = keywords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">🔍 老词挖掘</h1>
          <p className="text-sm text-muted-foreground mt-1">
            从已有搜索量中找低竞争机会词 · 按机会评分降序 · 点击行展开趋势图
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground">最低评分:</label>
          <input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-24 px-2 py-1 border rounded text-sm dark:bg-gray-800 dark:border-gray-700"
          />
          <button
            onClick={fetchKeywords}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            刷新
          </button>
          <button
            onClick={() => void runEvaluation(false)}
            disabled={evaluating}
            className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted disabled:opacity-50"
          >
            {evaluating ? "评分中..." : "真实评分 Top80"}
          </button>
          <button
            onClick={() => void runEvaluation(true)}
            disabled={evaluating}
            className="px-3 py-1.5 text-sm rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
          >
            强制重跑
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-muted-foreground">加载中...</div>
      ) : error ? (
        <div className="py-10 text-center text-red-500">{error}</div>
      ) : keywords.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground">
          暂无数据。等待老词管线运行后自动填充。
        </div>
      ) : (
        <>
          <div className="mb-4 flex gap-4 text-sm text-muted-foreground">
            <span>共 <strong className="text-foreground">{keywords.length}</strong> 个机会词</span>
            {keywords[0]?.scan_date && <span>扫描日期: {keywords[0].scan_date}</span>}
          </div>

          <div className="mb-3 rounded-lg border bg-muted/20 px-4 py-3 text-xs leading-6 text-muted-foreground">
            <span className="font-medium text-foreground">字段说明：</span>
            月搜索量=美国月均搜索量；CPC=广告点击均价；KD=关键词自然排名难度，越低越容易；竞争=广告竞争强度；意图=搜索意图分类；初筛分=搜索量、KD、CPC 加权；真实分=初筛分、SERP竞争、品牌安全、意图深度、内容可做性加权。
          </div>
          {lastEvaluation && (
            <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs leading-6 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-100">
              <span className="font-medium">最近评分：</span>
              <span>评估 {lastEvaluation.evaluated} 个</span>
              <span className="ml-3">跳过 {lastEvaluation.skippedExisting} 个</span>
              <span className="ml-3">成本 ${lastEvaluation.actualCostUsd.toFixed(4)}</span>
              {lastEvaluation.pipelineRunId && (
                <span className="ml-3 break-all">管线 {lastEvaluation.pipelineRunId}</span>
              )}
              {lastEvaluation.message && !lastEvaluation.pipelineRunId && (
                <span className="ml-3">{lastEvaluation.message}</span>
              )}
            </div>
          )}

          <div className="space-y-2">
            <KeywordHeader />
            {pageKeywords.map((kw, idx) => {
              const globalIdx = (page - 1) * PAGE_SIZE + idx;
              return (
                <KeywordRow
                  key={kw.keyword}
                  kw={kw}
                  globalIdx={globalIdx}
                  isExpanded={expandedIdx === globalIdx}
                  onToggle={() => setExpandedIdx(expandedIdx === globalIdx ? null : globalIdx)}
                />
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="px-2.5 py-1.5 text-sm rounded-md border border-border disabled:opacity-30 hover:bg-muted transition-colors"
              >
                首页
              </button>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2.5 py-1.5 text-sm rounded-md border border-border disabled:opacity-30 hover:bg-muted transition-colors"
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .map((p, i, arr) => (
                  <span key={p} className="contents">
                    {i > 0 && arr[i - 1] !== p - 1 && <span className="px-1 text-muted-foreground">...</span>}
                    <button
                      onClick={() => setPage(p)}
                      className={`w-8 h-8 text-sm rounded-md transition-colors ${
                        p === page
                          ? "bg-indigo-600 text-white"
                          : "border border-border hover:bg-muted"
                      }`}
                    >
                      {p}
                    </button>
                  </span>
                ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2.5 py-1.5 text-sm rounded-md border border-border disabled:opacity-30 hover:bg-muted transition-colors"
              >
                ›
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="px-2.5 py-1.5 text-sm rounded-md border border-border disabled:opacity-30 hover:bg-muted transition-colors"
              >
                末页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
