"use client";

import { useEffect, useState } from "react";
import { Database, Filter, RefreshCw, Search, ShieldCheck, Signal } from "lucide-react";

type SignalReviewStatus = "all" | "pending" | "accepted" | "rejected";

type SummaryRow = {
  status: string;
  count: number;
};

type ReasonRow = {
  reason: string;
  count: number;
};

type Candidate = {
  keyword: string;
  keywordNormalized: string;
  signalScore: number;
  avgHotness: number;
  dataforseoVolume: number;
  accepted: string | null;
  createdAt: string;
  sources: string[];
  evidenceCount: number;
};

type SignalReviewQueue = {
  status: SignalReviewStatus;
  limit: number;
  summary: SummaryRow[];
  rejectedReasons: ReasonRow[];
  candidates: Candidate[];
};

const statuses: { value: SignalReviewStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const formatDate = (value: string) => value ? new Date(value).toLocaleString("zh-CN") : "-";
const formatNumber = (value: number, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : "-";

const statusTone = (status: string | null) => {
  const value = status || "pending";
  if (value.startsWith("accepted:")) return "bg-emerald-50 text-emerald-700";
  if (value.startsWith("rejected:")) return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
};

export default function SignalReviewPage() {
  const [data, setData] = useState<SignalReviewQueue | null>(null);
  const [status, setStatus] = useState<SignalReviewStatus>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (nextStatus = status) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/signal-review?status=${nextStatus}&limit=50`, {
        cache: "no-store",
      });
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
    load(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const pendingCount = data?.summary.find((row) => row.status === "pending")?.count ?? 0;
  const acceptedCount = data?.summary
    .filter((row) => row.status.startsWith("accepted:"))
    .reduce((sum, row) => sum + row.count, 0) ?? 0;
  const rejectedCount = data?.summary
    .filter((row) => row.status.startsWith("rejected:"))
    .reduce((sum, row) => sum + row.count, 0) ?? 0;
  const totalCount = data?.summary.reduce((sum, row) => sum + row.count, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <Signal className="mt-1 h-6 w-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold">Signal Review Queue</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              只读查看多平台信号候选、状态分布和拒绝原因。这个页面不写库、不触发 DataForSEO、不改变学生端推荐。
            </p>
          </div>
        </div>
        <button
          onClick={() => load(status)}
          className="inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm hover:bg-muted"
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={<Database className="h-4 w-4" />} label="Total" value={totalCount} />
        <StatCard icon={<Search className="h-4 w-4" />} label="Pending" value={pendingCount} />
        <StatCard icon={<ShieldCheck className="h-4 w-4" />} label="Accepted" value={acceptedCount} />
        <StatCard icon={<Filter className="h-4 w-4" />} label="Rejected" value={rejectedCount} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold">Candidates</h2>
            <p className="text-xs text-muted-foreground">Top 50 by signal score for the selected status.</p>
          </div>
          <div className="inline-flex rounded-md border bg-background p-1">
            {statuses.map((option) => (
              <button
                key={option.value}
                onClick={() => setStatus(option.value)}
                className={`rounded px-3 py-1.5 text-sm ${
                  status === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <Th>Keyword</Th>
                <Th>Sources</Th>
                <Th align="right">Score</Th>
                <Th align="right">Hotness</Th>
                <Th align="right">Volume</Th>
                <Th align="right">Evidence</Th>
                <Th>Status</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
              ) : data?.candidates.length ? (
                data.candidates.map((row) => (
                  <tr key={`${row.keywordNormalized}-${row.createdAt}`} className="border-t hover:bg-muted/30">
                    <Td className="font-medium">
                      <div className="flex flex-col gap-1">
                        <span>{row.keyword}</span>
                        <span className="text-xs font-normal text-muted-foreground">{row.keywordNormalized}</span>
                      </div>
                    </Td>
                    <Td>
                      <div className="max-w-[280px] truncate" title={row.sources.join(", ") || "-"}>
                        {row.sources.length ? row.sources.join(", ") : "-"}
                      </div>
                    </Td>
                    <Td align="right">{formatNumber(row.signalScore)}</Td>
                    <Td align="right">{formatNumber(row.avgHotness)}</Td>
                    <Td align="right">{row.dataforseoVolume || "-"}</Td>
                    <Td align="right">{row.evidenceCount}</Td>
                    <Td>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone(row.accepted)}`}>
                        {row.accepted || "pending"}
                      </span>
                    </Td>
                    <Td>{formatDate(row.createdAt)}</Td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">暂无候选</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Rejected Reasons</h2>
          <p className="text-xs text-muted-foreground">用于观察噪音主要来自哪里，后续再决定是否调整 extractor 或 review 规则。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <Th>Reason</Th>
                <Th align="right">Count</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
              ) : data?.rejectedReasons.length ? (
                data.rejectedReasons.map((row) => (
                  <tr key={row.reason} className="border-t hover:bg-muted/30">
                    <Td className="font-mono text-xs">{row.reason}</Td>
                    <Td align="right">{row.count}</Td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">暂无拒绝原因</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
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
