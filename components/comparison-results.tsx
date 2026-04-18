"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import type { CompareResponse, ComparisonFreshnessStatus, ComparisonResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendChart } from "@/components/trend-chart";

type ComparisonResultsProps = {
  compareData: CompareResponse;
  showDetails?: boolean;
  backHref?: string;
  backLabel?: string;
};

const verdictLabel = (verdict: ComparisonResult["verdict"]) => {
  if (verdict === "strong") return "强通过";
  if (verdict === "pass") return "通过";
  if (verdict === "close") return "接近";
  if (verdict === "watch") return "观察";
  return "放弃";
};

const verdictBadge = (verdict: ComparisonResult["verdict"]) => {
  if (verdict === "strong") return "bg-emerald-100 text-emerald-700";
  if (verdict === "pass") return "bg-green-100 text-green-700";
  if (verdict === "close") return "bg-amber-100 text-amber-700";
  if (verdict === "watch") return "bg-sky-100 text-sky-700";
  return "bg-rose-100 text-rose-700";
};

const freshnessBadge = (status: ComparisonFreshnessStatus) => {
  if (status === "new") return "bg-violet-100 text-violet-700 border-violet-200";
  if (status === "old_hot") return "bg-orange-100 text-orange-700 border-orange-200";
  if (status === "stable_old") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-zinc-100 text-zinc-600 border-zinc-200";
};

const groupResults = (results: ComparisonResult[]) => {
  const strong: ComparisonResult[] = [];
  const pass: ComparisonResult[] = [];
  const close: ComparisonResult[] = [];
  const watch: ComparisonResult[] = [];
  const fail: ComparisonResult[] = [];

  for (const result of results) {
    if (result.verdict === "strong") strong.push(result);
    else if (result.verdict === "pass") pass.push(result);
    else if (result.verdict === "close") close.push(result);
    else if (result.verdict === "watch") watch.push(result);
    else fail.push(result);
  }

  return { strong, pass, close, watch, fail };
};

function PaginatedList<T>({
  items,
  renderItem,
  className,
  pageSize = 20,
  keyExtractor,
}: {
  items: T[];
  renderItem: (item: T) => ReactNode;
  className?: string;
  pageSize?: number;
  keyExtractor: (item: T) => string;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);

  const currentItems = items.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize
  );

  if (items.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className={className}>
        {currentItems.map((item) => (
          <div key={keyExtractor(item)}>{renderItem(item)}</div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={activePage === 1}
            className="h-8 w-8 p-0"
          >
            {"<"}
          </Button>
          <div className="text-xs text-muted-foreground">
            {activePage} / {totalPages}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={activePage === totalPages}
            className="h-8 w-8 p-0"
          >
            {">"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ComparisonResultsCard({
  compareData,
  showDetails = false,
  backHref,
  backLabel = "上一步",
}: ComparisonResultsProps) {
  const groupedResults = useMemo(
    () => groupResults(compareData.results),
    [compareData.results]
  );
  const defaultExpandedKeyword = useMemo(() => {
    const orderedGroups = [
      groupedResults.strong,
      groupedResults.pass,
      groupedResults.close,
      groupedResults.watch,
      groupedResults.fail,
    ];
    for (const group of orderedGroups) {
      if (group.length > 0) {
        return group[0].keyword;
      }
    }
    return null;
  }, [groupedResults]);
  const [expandedKeyword, setExpandedKeyword] = useState<string | null | undefined>(undefined);
  const currentExpandedKeyword =
    expandedKeyword === undefined ? defaultExpandedKeyword : expandedKeyword;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2">
          <CardTitle>第三步：趋势对比结果</CardTitle>
          <CardDescription className="flex items-center gap-2">
            时间范围:{" "}
            <Badge variant="outline" className="font-mono font-normal">
              {compareData.dateFrom}
            </Badge>{" "}
            至{" "}
            <Badge variant="outline" className="font-mono font-normal">
              {compareData.dateTo}
            </Badge>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {([
            { key: "strong", label: "强通过", count: compareData.summary.strong, color: "text-emerald-600 bg-emerald-50 border-emerald-100 ring-emerald-500/20" },
            { key: "pass", label: "通过", count: compareData.summary.pass, color: "text-green-600 bg-green-50 border-green-100 ring-green-500/20" },
            { key: "close", label: "接近", count: compareData.summary.close, color: "text-amber-600 bg-amber-50 border-amber-100 ring-amber-500/20" },
            { key: "watch", label: "观察", count: compareData.summary.watch, color: "text-blue-600 bg-sky-50 border-sky-100 ring-sky-500/20" },
            { key: "fail", label: "放弃", count: compareData.summary.fail, color: "text-rose-600 bg-rose-50 border-rose-100 ring-rose-500/20" },
          ] as const).map((item) => (
            <button
              key={item.key}
              onClick={() => {
                const el = document.getElementById(`comparison-group-${item.key}`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-xl border p-4 text-center transition-all hover:scale-105 hover:ring-2 hover:shadow-md",
                item.color
              )}
            >
              <div className="text-3xl font-bold">{item.count}</div>
              <div className="text-xs font-medium opacity-80">{item.label}</div>
            </button>
          ))}
        </div>

        <div className="space-y-6">
          {(["strong", "pass", "close", "watch", "fail"] as const).map(
            (groupKey) => {
              const list = groupedResults[groupKey];
              if (list.length === 0) return null;

              const titleKeyMap = {
                strong: "强通过 (Strong)",
                pass: "通过 (Pass)",
                close: "接近 (Close)",
                watch: "观察 (Watch)",
                fail: "放弃 (Fail)",
              };

              return (
                <div
                  key={groupKey}
                  id={`comparison-group-${groupKey}`}
                  className="space-y-3 scroll-mt-24"
                >
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm">{titleKeyMap[groupKey]}</h3>
                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                      {list.length}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <PaginatedList
                      items={list}
                      pageSize={20}
                      className="space-y-2"
                      keyExtractor={(item) => `${groupKey}-${item.keyword}`}
                      renderItem={(item) => (
                        <div className="group rounded-lg border p-4 text-sm transition-all hover:bg-muted/40">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-base">{item.keyword}</span>
                                {item.freshness ? (
                                  <Badge
                                    variant="outline"
                                    className={cn("text-[10px]", freshnessBadge(item.freshness.status))}
                                  >
                                    {item.freshness.label}
                                    {item.freshness.window !== "none" ? ` · ${item.freshness.window}` : ""}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span>热度: {item.avgValue}</span>
                                <span>基准: {item.benchmarkValue}</span>
                              </div>
                            </div>

                            <div className="flex flex-col items-start gap-2 sm:items-end">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="secondary"
                                  className={cn("font-medium", verdictBadge(item.verdict))}
                                >
                                  {item.ratio}x {verdictLabel(item.verdict)}
                                </Badge>
                                {showDetails && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() =>
                                      setExpandedKeyword((prev) =>
                                        (prev === undefined ? defaultExpandedKeyword : prev) === item.keyword
                                          ? null
                                          : item.keyword
                                      )
                                    }
                                  >
                                    {currentExpandedKeyword === item.keyword ? "收起" : "查看趋势/原因"}
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>

                          {showDetails && currentExpandedKeyword === item.keyword && (
                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                              <div className="rounded-md border bg-muted/30 p-3">
                                {item.series ? (
                                  <TrendChart
                                    timestamps={item.series.timestamps ?? []}
                                    values={item.series.values ?? []}
                                    benchmarkValues={item.series.benchmarkValues ?? []}
                                    keyword={item.keyword}
                                    benchmark={compareData.benchmark}
                                  />
                                ) : (
                                  <div className="text-xs text-muted-foreground">
                                    暂无趋势曲线（旧记录未落库）
                                  </div>
                                )}
                              </div>
                              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                                <div className="space-y-4">
                                  {item.intent ? (
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[10px]">
                                          {item.intent.label}
                                        </Badge>
                                        {typeof item.intent.confidence === "number" && (
                                          <span className="text-[10px] text-muted-foreground">
                                            置信度 {Math.round(item.intent.confidence * 100)}%
                                          </span>
                                        )}
                                      </div>
                                      <div>
                                        <span className="font-medium text-foreground">需求：</span>
                                        {item.intent.demand}
                                      </div>
                                      <div>
                                        <span className="font-medium text-foreground">依据：</span>
                                        {item.intent.reason}
                                      </div>
                                    </div>
                                  ) : (
                                    <div>暂无需求分析（旧记录未落库）</div>
                                  )}

                                  {item.explanation ? (
                                    <div className="space-y-2">
                                      <div className="font-medium text-foreground">
                                        {item.explanation.summary}
                                      </div>
                                      <ul className="list-disc space-y-1 pl-4">
                                        {item.explanation.reasons.map((reason, idx) => (
                                          <li key={`${item.keyword}-reason-${idx}`}>{reason}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : (
                                    <div>暂无趋势原因说明（旧记录未落库）</div>
                                  )}

                                  {item.freshness ? (
                                    <div className="rounded-md border bg-background/60 p-2">
                                      <div className="font-medium text-foreground">
                                        新鲜度：{item.freshness.label}
                                        {item.freshness.window !== "none" ? `（${item.freshness.window}）` : ""}
                                      </div>
                                      <div>{item.freshness.reason}</div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    />
                  </div>
                </div>
              );
            }
          )}
        </div>
      </CardContent>
      {backHref && (
        <CardFooter className="flex justify-between border-t bg-muted/50 px-6 py-4">
          <Link href={backHref}>
            <Button variant="outline">{backLabel}</Button>
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}
