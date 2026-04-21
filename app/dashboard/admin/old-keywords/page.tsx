"use client";

import { useState, useEffect, useCallback } from "react";

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
};

export default function OldKeywordsPage() {
  const [keywords, setKeywords] = useState<OldKeyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [minScore, setMinScore] = useState(0);

  const fetchKeywords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/old-keywords?limit=200&minScore=${minScore}`);
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      setKeywords(data.keywords || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, [minScore]);

  useEffect(() => { fetchKeywords(); }, [fetchKeywords]);

  const kdColor = (kd: number) => {
    if (kd <= 15) return "text-green-600 dark:text-green-400";
    if (kd <= 35) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const compBadge = (comp: string) => {
    if (comp === "LOW") return <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">LOW</span>;
    if (comp === "MEDIUM") return <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">MEDIUM</span>;
    return <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{comp || "-"}</span>;
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">🔍 老词挖掘</h1>
          <p className="text-sm text-muted-foreground mt-1">
            从已有搜索量中找低竞争机会词（keyword_suggestions API）
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

          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">关键词</th>
                  <th className="px-3 py-2 text-right font-medium">月搜索量</th>
                  <th className="px-3 py-2 text-right font-medium">CPC</th>
                  <th className="px-3 py-2 text-right font-medium">KD</th>
                  <th className="px-3 py-2 text-center font-medium">竞争</th>
                  <th className="px-3 py-2 text-center font-medium">意图</th>
                  <th className="px-3 py-2 text-right font-medium">评分</th>
                  <th className="px-3 py-2 text-left font-medium">来源种子</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((kw, idx) => (
                  <tr key={kw.keyword} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                    <td className="px-3 py-2 font-medium">{kw.keyword}</td>
                    <td className="px-3 py-2 text-right">{kw.volume.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">${kw.cpc.toFixed(2)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${kdColor(kw.kd)}`}>{kw.kd}</td>
                    <td className="px-3 py-2 text-center">{compBadge(kw.competition)}</td>
                    <td className="px-3 py-2 text-center text-xs text-muted-foreground">{kw.intent}</td>
                    <td className="px-3 py-2 text-right font-bold text-indigo-600 dark:text-indigo-400">{kw.score.toLocaleString()}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{kw.source_seed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
