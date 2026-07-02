"use client";

import { useEffect, useMemo, useState } from "react";
import { LockKeyhole, RefreshCw, Search, Star, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Opportunity = {
  id: string;
  keyword: string;
  pipeline: "google_new" | "game_new" | "validated_market";
  category: string;
  status: "strong_pass" | "pass" | "close" | "watch" | "skip";
  opportunityScore: number;
  demandSummary: string;
  evidenceSummary: string;
  bestBuildType: string;
  riskLevel: "low" | "medium" | "high";
  currentHeat: number | null;
  recentRatio: number | null;
  trendSlope: number | null;
  sourceLabel: string;
  updatedAt: string | null;
  isPublicSample: boolean;
};

type OpportunitiesResponse = {
  gated: boolean;
  items: Opportunity[];
  total: number;
  entitlement?: {
    allowed: boolean;
    reason?: string;
    source: string;
    planKey: string | null;
  };
};

const pipelineOptions = [
  { value: "", label: "All pipelines" },
  { value: "google_new", label: "New keywords" },
  { value: "game_new", label: "Games" },
  { value: "validated_market", label: "Validated markets" },
];

const statusOptions = [
  { value: "", label: "All statuses" },
  { value: "strong_pass", label: "Strong Pass" },
  { value: "pass", label: "Pass" },
  { value: "close", label: "Close" },
  { value: "watch", label: "Watch" },
];

const categoryOptions = [
  { value: "", label: "All categories" },
  { value: "ai_tools", label: "AI tools" },
  { value: "games", label: "Games" },
  { value: "saas", label: "SaaS" },
  { value: "tools", label: "Tools" },
  { value: "templates", label: "Templates" },
  { value: "other", label: "Other" },
];

const statusLabel = (status: Opportunity["status"]) => {
  if (status === "strong_pass") return "Strong Pass";
  if (status === "pass") return "Pass";
  if (status === "close") return "Close";
  if (status === "watch") return "Watch";
  return "Skip";
};

const pipelineLabel = (pipeline: Opportunity["pipeline"]) => {
  if (pipeline === "google_new") return "New keyword";
  if (pipeline === "game_new") return "Game";
  return "Validated market";
};

const badgeVariant = (status: Opportunity["status"]) =>
  status === "strong_pass" || status === "pass" ? "default" : "secondary";

const formatMetric = (value: number | null) =>
  value === null || Number.isNaN(value) ? "-" : Number(value).toFixed(value > 20 ? 0 : 2);

export default function OpportunityRadarPage() {
  const [query, setQuery] = useState("");
  const [pipeline, setPipeline] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [data, setData] = useState<OpportunitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (pipeline) p.set("pipeline", pipeline);
    if (status) p.set("status", status);
    if (category) p.set("category", category);
    p.set("limit", "80");
    return p;
  }, [category, pipeline, query, status]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/opportunities?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Failed to load opportunities");
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load opportunities");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const subscribe = async () => {
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST" });
      const payload = await response.json();
      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(payload?.error || "Stripe checkout is not configured");
      }
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stripe checkout is not configured");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Opportunity Radar</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A unified view of buildable keyword opportunities from new keyword, game, and validated market pipelines.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {data?.gated && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-3">
              <LockKeyhole className="mt-0.5 h-5 w-5 text-amber-700" />
              <div>
                <div className="font-medium text-amber-900 dark:text-amber-100">Public samples only</div>
                <p className="text-sm text-amber-800/80 dark:text-amber-100/80">
                  {data.entitlement?.reason || "Subscribe or activate your trial to unlock the full opportunity database."}
                </p>
              </div>
            </div>
            <Button type="button" onClick={subscribe}>
              Subscribe
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card/90 p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search keyword"
              className="pl-9"
            />
          </div>
          <select value={pipeline} onChange={(event) => setPipeline(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
            {pipelineOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm">
            {categoryOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-4 text-sm text-red-700 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground">Loading opportunities...</div>
      ) : data?.items.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {data.items.map((item) => (
            <article key={item.id} className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badgeVariant(item.status)}>{statusLabel(item.status)}</Badge>
                    <Badge variant="outline">{pipelineLabel(item.pipeline)}</Badge>
                    <Badge variant="secondary">{item.category.replace("_", " ")}</Badge>
                    {item.isPublicSample && <Badge variant="outline">Sample</Badge>}
                  </div>
                  <h2 className="mt-3 break-words text-xl font-semibold">{item.keyword}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.demandSummary}</p>
                </div>
                <div className="shrink-0 rounded-lg border bg-muted/30 px-3 py-2 text-center">
                  <Star className="mx-auto h-4 w-4 text-amber-500" />
                  <div className="mt-1 text-2xl font-bold">{item.opportunityScore}</div>
                  <div className="text-xs text-muted-foreground">Score</div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Heat</div>
                  <div className="font-medium">{formatMetric(item.currentHeat)}</div>
                </div>
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Recent ratio</div>
                  <div className="font-medium">{formatMetric(item.recentRatio)}</div>
                </div>
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="text-xs text-muted-foreground">Slope</div>
                  <div className="flex items-center gap-1 font-medium">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                    {formatMetric(item.trendSlope)}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <p><span className="font-medium">Best build type:</span> {item.bestBuildType}</p>
                <p><span className="font-medium">Evidence:</span> {item.evidenceSummary}</p>
                <p className="text-xs text-muted-foreground">
                  Source: {item.sourceLabel} {item.updatedAt ? `- Updated ${item.updatedAt.slice(0, 10)}` : ""}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground">
          No opportunities match the current filters.
        </div>
      )}
    </div>
  );
}
