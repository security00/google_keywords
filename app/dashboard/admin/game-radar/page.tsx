"use client";

import { useEffect, useState } from "react";
import { Radar, RefreshCw } from "lucide-react";

type SourceRow = {
  id: string;
  name: string;
  base_url: string;
  sitemap_url: string;
  enabled: number;
  quality_tier: number;
  status_note: string | null;
  last_checked_at: string | null;
  page_count: number;
  candidate_count: number;
  latest_candidate_at: string | null;
};

type CandidateRow = {
  id: string;
  keyword: string;
  keyword_normalized: string;
  source_id: string;
  source_name: string;
  url: string;
  status: string;
  reject_reason: string | null;
  created_at: string;
};

type StatusRow = {
  status: string;
  count: number;
};

type Payload = {
  sources: SourceRow[];
  candidates: CandidateRow[];
  statusCounts: StatusRow[];
};

const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "-";

export default function GameRadarPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingSource, setSavingSource] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/game-radar", { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "加载失败");
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totalCandidates = data?.statusCounts.reduce((sum, row) => sum + Number(row.count || 0), 0) ?? 0;

  const updateSource = async (id: string, patch: { enabled?: boolean; statusNote?: string | null }) => {
    setSavingSource(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/game-radar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "保存失败");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingSource(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Radar className="h-6 w-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold">Game Page Radar</h1>
            <p className="text-sm text-muted-foreground">
              精选游戏站 sitemap 新页面追踪。当前只做候选预览，不触发 Trends/SERP/LLM，不进学生端。
            </p>
          </div>
        </div>
        <button onClick={load} className="rounded-md border p-2 hover:bg-muted" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="来源数" value={data?.sources.length ?? 0} />
        <Stat label="候选词" value={totalCandidates} />
        <Stat label="状态分布" value={(data?.statusCounts ?? []).map((row) => `${row.status}:${row.count}`).join(" / ") || "-"} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">精选来源</h2>
          <p className="text-xs text-muted-foreground">先看各站 sitemap 是否可用，以及候选产出是否明显偏旧/偏噪。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <Th>来源</Th>
                <Th>状态</Th>
                <Th>策略备注</Th>
                <Th align="right">页面</Th>
                <Th align="right">候选</Th>
                <Th>最近检查</Th>
                <Th>Sitemap</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
              ) : data?.sources.length ? (
                data.sources.map((row) => (
                  <tr key={row.id} className="border-t hover:bg-muted/30">
                    <Td className="font-medium">{row.name}</Td>
                    <Td>
                      <button
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                        disabled={savingSource === row.id}
                        onClick={() => updateSource(row.id, { enabled: !row.enabled })}
                      >
                        {savingSource === row.id ? "保存中" : row.enabled ? "启用" : "停用"}
                      </button>
                    </Td>
                    <Td className="min-w-[320px] max-w-[420px] text-xs text-muted-foreground" title={row.status_note || undefined}>
                      <div className="flex items-center gap-2">
                        <span className="line-clamp-2 flex-1">{row.status_note || "-"}</span>
                        <button
                          className="shrink-0 rounded border px-2 py-1 text-xs text-foreground hover:bg-muted"
                          disabled={savingSource === row.id}
                          onClick={() => {
                            const next = window.prompt("编辑来源策略备注", row.status_note || "");
                            if (next !== null) updateSource(row.id, { statusNote: next });
                          }}
                        >编辑</button>
                      </div>
                    </Td>
                    <Td align="right">{row.page_count}</Td>
                    <Td align="right">{row.candidate_count}</Td>
                    <Td>{date(row.last_checked_at)}</Td>
                    <Td className="max-w-[420px] truncate text-muted-foreground" title={row.sitemap_url}>{row.sitemap_url}</Td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">暂无来源</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">最新候选</h2>
          <p className="text-xs text-muted-foreground">这些只是 sitemap/page 提词结果，后续还必须经过 Trends 和 SERP 游戏相关性校验。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <Th>关键词</Th>
                <Th>来源</Th>
                <Th>状态</Th>
                <Th>发现时间</Th>
                <Th>URL</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
              ) : data?.candidates.length ? (
                data.candidates.map((row) => (
                  <tr key={row.id} className="border-t hover:bg-muted/30">
                    <Td className="font-medium">{row.keyword}</Td>
                    <Td>{row.source_name}</Td>
                    <Td>{row.status}{row.reject_reason ? ` · ${row.reject_reason}` : ""}</Td>
                    <Td>{date(row.created_at)}</Td>
                    <Td className="max-w-[520px] truncate text-muted-foreground" title={row.url}>
                      <a href={row.url} target="_blank" rel="noreferrer" className="hover:underline">{row.url}</a>
                    </Td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">暂无候选</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"} font-medium`}>{children}</th>;
}

function Td({ children, align = "left", className = "", title }: { children: React.ReactNode; align?: "left" | "right"; className?: string; title?: string }) {
  return <td title={title} className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}</td>;
}
