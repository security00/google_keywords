"use client";

import { useEffect, useState } from "react";
import { Activity, Database, RefreshCw, Signal, Trophy } from "lucide-react";

type GameSourceQualityRow = {
  source_site: string;
  total_checked: number;
  recommended_count: number;
  hot_count: number;
  rising_count: number;
  niche_count: number;
  skip_count: number;
  avg_trend_ratio: number | null;
  avg_trend_slope: number | null;
  avg_serp_auth: number | null;
  snr: number;
  last_checked_at: string | null;
  status: {
    label: string;
    tone: "active" | "muted";
    note: string | null;
  };
};

type SitemapSourceQualityRow = {
  source_id: string;
  name: string | null;
  sitemap_url: string;
  enabled: number;
  discovered_count: number;
  new_count: number;
  last_checked_at: string | null;
  last_extracted_at: string | null;
};

type SourceQualityStats = {
  summary: {
    sourceCount: number;
    totalChecked: number;
    totalRecommended: number;
    overallSnr: number;
    bestSource: string | null;
  };
  gameSources: GameSourceQualityRow[];
  sitemapSources: SitemapSourceQualityRow[];
};

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const num = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || Number.isNaN(value) ? "-" : value.toFixed(digits);
const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "-";

export default function SourceQualityPage() {
  const [stats, setStats] = useState<SourceQualityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/source-quality", { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "加载失败");
      setStats(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const summary = stats?.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Signal className="h-6 w-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold">信号源质量</h1>
            <p className="text-sm text-muted-foreground">
              只读聚合现有游戏关键词与 sitemap 发现数据，评估各来源产出质量，不触发外部计费调用。
            </p>
          </div>
        </div>
        <button onClick={load} className="rounded-md border p-2 hover:bg-muted" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={<Database className="h-4 w-4" />} label="游戏来源数" value={summary?.sourceCount ?? 0} />
        <StatCard icon={<Activity className="h-4 w-4" />} label="已扫描关键词" value={summary?.totalChecked ?? 0} />
        <StatCard icon={<Trophy className="h-4 w-4" />} label="推荐关键词" value={summary?.totalRecommended ?? 0} />
        <StatCard icon={<Signal className="h-4 w-4" />} label="整体 SNR" value={pct(summary?.overallSnr ?? 0)} hint={summary?.bestSource ? `最佳：${summary.bestSource}` : undefined} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">游戏信号源质量</h2>
          <p className="text-xs text-muted-foreground">SNR = 推荐数 / 已扫描数。推荐包含 🔥 hot、📈 rising、🎯 niche。已停用历史源仅作历史参考，不代表当前采集链路异常。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <Th>来源</Th>
                <Th align="right">扫描</Th>
                <Th align="right">推荐</Th>
                <Th align="right">SNR</Th>
                <Th align="right">🔥</Th>
                <Th align="right">📈</Th>
                <Th align="right">🎯</Th>
                <Th align="right">⏭️</Th>
                <Th align="right">趋势比均值</Th>
                <Th align="right">斜率均值</Th>
                <Th align="right">权威站均值</Th>
                <Th>最近扫描</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
              ) : stats?.gameSources.length ? (
                stats.gameSources.map((row) => (
                  <tr key={row.source_site} className="border-t hover:bg-muted/30">
                    <Td className="font-medium">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span>{row.source_site}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] ${row.status.tone === "muted" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>
                            {row.status.label}
                          </span>
                        </div>
                        {row.status.note && <span className="max-w-[360px] text-xs font-normal text-muted-foreground">{row.status.note}</span>}
                      </div>
                    </Td>
                    <Td align="right">{row.total_checked}</Td>
                    <Td align="right">{row.recommended_count}</Td>
                    <Td align="right"><span className="font-mono">{pct(row.snr)}</span></Td>
                    <Td align="right">{row.hot_count}</Td>
                    <Td align="right">{row.rising_count}</Td>
                    <Td align="right">{row.niche_count}</Td>
                    <Td align="right">{row.skip_count}</Td>
                    <Td align="right">{num(row.avg_trend_ratio)}</Td>
                    <Td align="right">{num(row.avg_trend_slope)}</Td>
                    <Td align="right">{num(row.avg_serp_auth, 1)}</Td>
                    <Td>{date(row.last_checked_at)}</Td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">暂无游戏来源统计</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Sitemap 发现源</h2>
          <p className="text-xs text-muted-foreground">辅助观察各 sitemap 源的候选产出量与检查状态。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <Th>名称</Th>
                <Th>状态</Th>
                <Th align="right">发现数</Th>
                <Th align="right">新候选</Th>
                <Th>最近检查</Th>
                <Th>最近提取</Th>
                <Th>URL</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
              ) : stats?.sitemapSources.length ? (
                stats.sitemapSources.map((row) => (
                  <tr key={row.source_id} className="border-t hover:bg-muted/30">
                    <Td className="font-medium">{row.name || row.source_id}</Td>
                    <Td>{row.enabled ? "启用" : "停用"}</Td>
                    <Td align="right">{row.discovered_count}</Td>
                    <Td align="right">{row.new_count}</Td>
                    <Td>{date(row.last_checked_at)}</Td>
                    <Td>{date(row.last_extracted_at)}</Td>
                    <Td className="max-w-[360px] truncate text-muted-foreground" title={row.sitemap_url}>{row.sitemap_url}</Td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">暂无 sitemap 来源</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-3 text-${align} font-medium`}>{children}</th>;
}

function Td({ children, align = "left", className = "", title }: { children: React.ReactNode; align?: "left" | "right"; className?: string; title?: string }) {
  return <td className={`px-4 py-3 text-${align} ${className}`} title={title}>{children}</td>;
}
