"use client";

import { useState, useEffect, useMemo } from "react";
import { Gamepad2, TrendingUp, Flame, Target, SkipForward, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";

type TrendSeries = {
  timestamps: string[];
  values: number[];
  benchmarkValues: number[];
};

type GameKeyword = {
  keyword: string;
  source_site: string;
  trend_ratio: number;
  trend_slope: number;
  trend_verdict: string;
  serp_organic: number;
  serp_auth: number;
  serp_featured: number;
  recommendation: string;
  reason: string;
  status: string;
  trend_checked_at: string;
  created_at: string;
  trend_series: string | null; // JSON string
};

const recIcon: Record<string, React.ReactNode> = {
  "🔥 hot": <Flame className="h-4 w-4 text-red-500" />,
  "📈 rising": <TrendingUp className="h-4 w-4 text-orange-500" />,
  "🎯 niche": <Target className="h-4 w-4 text-green-500" />,
  "⏭️ skip": <SkipForward className="h-4 w-4 text-gray-400" />,
};

export default function GameKeywordsPage() {
  const [items, setItems] = useState<GameKeyword[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filter, setFilter] = useState<"all" | "recommended">("recommended");
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setExpandedKey(null);
  }, [filter]);

  useEffect(() => {
    load();
  }, [page, filter]);

  async function load() {
    setLoading(true);
    try {
      const f = filter === "recommended" ? "&filter=recommended" : "";
      const r = await fetch(`/api/admin/game-keywords?page=${page}&pageSize=20${f}`);
      const d = await r.json();
      setItems(d.items || []);
      setTotal(d.total || 0);
      setTotalPages(d.totalPages || 1);
    } catch {
      console.error("load failed");
    } finally {
      setLoading(false);
    }
  }

  const recommended = items.filter((i) => i.recommendation !== "⏭️ skip");
  const skipped = items.filter((i) => i.recommendation === "⏭️ skip");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gamepad2 className="h-6 w-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold">新游发现</h1>
            <p className="text-sm text-muted-foreground">
              每日自动扫描 Steam + CrazyGames 新游戏，对比趋势与 SERP 竞争
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "all" | "recommended")}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            <option value="recommended">仅推荐</option>
            <option value="all">全部</option>
          </select>
          <button onClick={load} className="rounded-md border p-2 hover:bg-muted">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5"><Flame className="h-4 w-4 text-red-500" /> <strong>🔥 Hot</strong> — ratio ≥ 2.0，流量远超基准</span>
          <span className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-orange-500" /> <strong>📈 Rising</strong> — ratio ≥ 0.5 且 slope{'>'} 0，有权威站竞争</span>
          <span className="flex items-center gap-1.5"><Target className="h-4 w-4 text-green-500" /> <strong>🎯 Niche</strong> — 低竞争机会（无/少权威站）</span>
          <span className="flex items-center gap-1.5"><SkipForward className="h-4 w-4 text-gray-400" /> <strong>⏭️ Skip</strong> — 趋势太低或下滑，不推荐</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="总扫描" value={total} />
        <StatCard label="🔥 Hot" value={items.filter((i) => i.recommendation === "🔥 hot").length} color="text-red-500" />
        <StatCard label="📈 Rising" value={items.filter((i) => i.recommendation === "📈 rising").length} color="text-orange-500" />
        <StatCard label="🎯 Niche" value={items.filter((i) => i.recommendation === "🎯 niche").length} color="text-green-500" />
      </div>

      {/* Table */}
      <div className="relative rounded-lg border bg-card">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium w-8"></th>
                <th className="px-4 py-3 text-left font-medium">评级</th>
                <th className="px-4 py-3 text-left font-medium">关键词</th>
                <th className="px-4 py-3 text-left font-medium">来源</th>
                <th className="px-4 py-3 text-right font-medium">趋势比</th>
                <th className="px-4 py-3 text-right font-medium">斜率</th>
                <th className="px-4 py-3 text-right font-medium">SERP</th>
                <th className="px-4 py-3 text-left font-medium">原因</th>
                <th className="px-4 py-3 text-left font-medium">扫描时间</th>
              </tr>
            </thead>
            <tbody>
              {recommended.map((item) => (
                <GameRow
                  key={item.keyword + item.source_site}
                  item={item}
                  expanded={expandedKey === item.keyword}
                  onToggle={() => setExpandedKey(expandedKey === item.keyword ? null : item.keyword)}
                />
              ))}
              {filter === "all" && skipped.length > 0 && (
                <>
                  <tr>
                    <td colSpan={9} className="border-t bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground">
                      ⏭️ 跳过 ({skipped.length})
                    </td>
                  </tr>
                  {skipped.map((item) => (
                    <GameRow
                      key={item.keyword + item.source_site}
                      item={item}
                      dimmed
                      expanded={expandedKey === item.keyword}
                      onToggle={() => setExpandedKey(expandedKey === item.keyword ? null : item.keyword)}
                    />
                  ))}
                </>
              )}
              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    暂无数据，等待每日自动扫描
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="rounded border px-3 py-1 text-sm disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="rounded border px-3 py-1 text-sm disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}

function parseSeries(raw: string | null): TrendSeries | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s?.timestamps?.length && s?.values?.length) return s;
  } catch {}
  return null;
}

function GameRow({ item, dimmed, expanded, onToggle }: { item: GameKeyword; dimmed?: boolean; expanded: boolean; onToggle: () => void }) {
  const series = useMemo(() => parseSeries(item.trend_series), [item.trend_series]);
  const hasChart = !!series;

  return (
    <>
      <tr className={`border-b last:border-0 hover:bg-muted/30 ${dimmed ? "opacity-50" : ""}`}>
        <td className="px-2 py-3">
          {hasChart && (
            <button onClick={onToggle} className="p-1 rounded hover:bg-muted">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            {recIcon[item.recommendation] || null}
            <span className="text-xs">{item.recommendation}</span>
          </div>
        </td>
        <td className="px-4 py-3 font-medium">{item.keyword}</td>
        <td className="px-4 py-3 text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {item.source_site}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-mono">{item.trend_ratio?.toFixed(2) ?? "-"}</td>
        <td className="px-4 py-3 text-right font-mono">{item.trend_slope?.toFixed(2) ?? "-"}</td>
        <td className="px-4 py-3 text-right">
          <span className="text-xs">
            {item.serp_organic ?? "-"} organic / {item.serp_auth ?? "-"} auth
          </span>
        </td>
        <td className="max-w-[200px] truncate px-4 py-3 text-xs text-muted-foreground" title={item.reason}>
          {item.reason || "-"}
        </td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {item.trend_checked_at ? new Date(item.trend_checked_at).toLocaleDateString("zh-CN") : "-"}
        </td>
      </tr>
      {/* Expanded chart row */}
      {expanded && series && (
        <tr className="border-b bg-muted/10">
          <td colSpan={9} className="px-6 py-4">
            <TrendChart keyword={item.keyword} series={series} />
          </td>
        </tr>
      )}
    </>
  );
}

function TrendChart({ keyword, series }: { keyword: string; series: TrendSeries }) {
  const data = useMemo(() => {
    return series.timestamps.map((ts, i) => ({
      date: ts.slice(5, 10), // MM-DD
      [keyword]: series.values[i],
      gpts: series.benchmarkValues[i],
    }));
  }, [keyword, series]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">趋势对比（vs GPTs）</h3>
        <span className="text-xs text-muted-foreground">
          {series.timestamps.length} 天数据
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey={keyword}
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="gpts"
            stroke="#22c55e"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${color || ""}`}>{value}</div>
    </div>
  );
}
