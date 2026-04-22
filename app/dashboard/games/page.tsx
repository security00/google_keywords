"use client";

import { useState, useEffect, useMemo } from "react";
import { Gamepad2, TrendingUp, Flame, Target, SkipForward, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
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
  recommendation: string;
  reason: string;
  trend_checked_at: string;
  trend_series: string | null;
};

const recIcon: Record<string, React.ReactNode> = {
  "🔥 hot": <Flame className="h-4 w-4 text-red-500" />,
  "📈 rising": <TrendingUp className="h-4 w-4 text-orange-500" />,
  "🎯 niche": <Target className="h-4 w-4 text-green-500" />,
  "⏭️ skip": <SkipForward className="h-4 w-4 text-gray-400" />,
};

export default function StudentGamesPage() {
  const [items, setItems] = useState<GameKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/game-keywords");
      const d = await r.json();
      const list = d.keywords || [];
      setItems(list);
      // Auto-expand first
      if (list.length > 0) setExpandedKey(list[0].keyword);
    } catch {
      console.error("load failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Gamepad2 className="h-6 w-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold">🎮 新游发现</h1>
            <p className="text-sm text-muted-foreground">
              每日自动扫描 Steam + CrazyGames 新游戏，发现流量机会
            </p>
          </div>
        </div>
        <button onClick={load} className="rounded-md border p-2 hover:bg-muted">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Legend */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5"><Flame className="h-4 w-4 text-red-500" /> <strong>🔥 Hot</strong> — 流量远超基准，值得关注</span>
          <span className="flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-orange-500" /> <strong>📈 Rising</strong> — 上升趋势，有竞争</span>
          <span className="flex items-center gap-1.5"><Target className="h-4 w-4 text-green-500" /> <strong>🎯 Niche</strong> — 低竞争蓝海机会</span>
        </div>
      </div>

      {/* Cards instead of table for cleaner student UX */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">加载中...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          <Gamepad2 className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p>暂无推荐游戏关键词</p>
          <p className="text-xs mt-1">系统每日自动扫描，请稍后再来查看</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <GameCard
              key={item.keyword + item.source_site}
              item={item}
              expanded={expandedKey === item.keyword}
              onToggle={() => setExpandedKey(expandedKey === item.keyword ? null : item.keyword)}
            />
          ))}
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
        💡 数据来源：Steam 新品 + CrazyGames 新游，每日 UTC 10:00 自动更新。
        趋势对比基准为 &quot;GPTs&quot; 关键词。14天趋势窗口。
      </div>
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

function GameCard({ item, expanded, onToggle }: { item: GameKeyword; expanded: boolean; onToggle: () => void }) {
  const series = useMemo(() => parseSeries(item.trend_series), [item.trend_series]);

  return (
    <div className={`rounded-lg border bg-card transition-shadow hover:shadow-md ${expanded ? "ring-1 ring-primary/20" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-1.5 shrink-0">
          {recIcon[item.recommendation] || null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{item.keyword}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {item.source_site || "Steam/CrazyGames"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.reason}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-sm">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">趋势比</div>
            <div className="font-mono font-medium">{item.trend_ratio?.toFixed(2) ?? "-"}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">斜率</div>
            <div className={`font-mono font-medium ${(item.trend_slope ?? 0) > 0 ? "text-green-500" : "text-red-400"}`}>
              {item.trend_slope?.toFixed(2) ?? "-"}
            </div>
          </div>
          {series ? (
            expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <div className="w-4" />
          )}
        </div>
      </div>

      {/* Expanded trend chart */}
      {expanded && series && (
        <div className="border-t px-4 py-4 bg-muted/5">
          <TrendChart keyword={item.keyword} series={series} />
        </div>
      )}
    </div>
  );
}

function TrendChart({ keyword, series }: { keyword: string; series: TrendSeries }) {
  const data = useMemo(() => {
    return series.timestamps.map((ts, i) => ({
      date: ts.slice(5, 10),
      [keyword]: series.values[i],
      gpts: series.benchmarkValues[i],
    }));
  }, [keyword, series]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">趋势对比（紫色 = {keyword}，绿色虚线 = GPTs 基准）</h3>
        <span className="text-xs text-muted-foreground">{series.timestamps.length} 天</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
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
          <Line type="monotone" dataKey={keyword} stroke="#6366f1" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="gpts" stroke="#22c55e" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
