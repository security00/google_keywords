"use client";

import { useState, useEffect } from "react";
import { Search, TrendingUp, ExternalLink } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

type OldKeyword = {
  keyword: string;
  volume: number;
  cpc: number;
  kd: number;
  competition: string;
  score: number;
  trend?: {
    keyword: Array<{ date: string; value: number }>;
    benchmark: Array<{ date: string; value: number }>;
  };
};

function TrendChart({ trend }: { trend: OldKeyword["trend"] }) {
  if (!trend || trend.keyword.length === 0) return null;

  const dateMap = new Map<string, { date: string; kw: number; bm: number }>();
  for (const p of trend.keyword) dateMap.set(p.date, { date: p.date, kw: p.value, bm: 0 });
  for (const p of trend.benchmark) {
    const entry = dateMap.get(p.date);
    if (entry) entry.bm = p.value;
  }
  const chartData = Array.from(dateMap.values());

  return (
    <div className="w-full h-[160px] mt-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={30} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="kw" name="关键词" stroke="#6366f1" strokeWidth={2} dot={false} />
          {trend.benchmark.length > 0 && (
            <Line type="monotone" dataKey="bm" name="趋势基准" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function kdBadge(kd: number) {
  if (kd <= 15) return <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">KD {kd} · 容易</span>;
  if (kd <= 35) return <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">KD {kd} · 中等</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">KD {kd} · 困难</span>;
}

export default function OldKeywordsPage() {
  const [keywords, setKeywords] = useState<OldKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/old-keywords");
        const data = await res.json();
        if (!res.ok) {
          throw new Error(typeof data?.error === "string" ? data.error : "加载失败");
        }
        setKeywords(data.keywords || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知错误");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="py-20 text-center text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="py-20 text-center text-red-500">{error}</div>
      </div>
    );
  }

  if (keywords.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="py-20 text-center text-muted-foreground">暂无推荐关键词，请稍后再来查看</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-0 py-2 sm:px-4 sm:py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Search className="h-6 w-6 text-indigo-600" />
          为你推荐的老词机会
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          基于你的偏好筛选的低竞争关键词，适合切入建站
        </p>
      </div>

      <div className="space-y-4">
        {keywords.map((kw) => (
          <div key={kw.keyword} className="rounded-xl border bg-card p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 break-words text-lg font-semibold">
                  <TrendingUp className="h-4 w-4 text-indigo-500" />
                  {kw.keyword}
                </h2>
              </div>
              {kdBadge(kw.kd)}
            </div>

            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              <div className="text-center p-2 bg-muted/50 rounded-lg">
                <div className="text-xl font-bold">{kw.volume.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">月搜索量</div>
              </div>
              <div className="text-center p-2 bg-muted/50 rounded-lg">
                <div className="text-xl font-bold">${kw.cpc.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">CPC</div>
              </div>
              <div className="text-center p-2 bg-muted/50 rounded-lg">
                <div className="text-xl font-bold">{kw.competition || "-"}</div>
                <div className="text-xs text-muted-foreground">竞争度</div>
              </div>
            </div>

            {kw.trend && <TrendChart trend={kw.trend} />}

            <div className="mt-3 flex justify-start sm:justify-end">
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(kw.keyword)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-indigo-600 flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                查看谷歌搜索结果
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
