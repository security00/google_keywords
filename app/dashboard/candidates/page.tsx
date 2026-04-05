"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { countEstimate, formatUsd, useResearch } from "@/lib/context/research-context";
import type { Candidate, OrganizedCandidates } from "@/lib/types";

const candidateTypeLabel = (type: "top" | "rising") => (type === "rising" ? "RISING" : "TOP");

const mapOrganizedSections = (organized: OrganizedCandidates) => [
  {
    key: "explosive",
    title: "爆发词",
    subtitle: "> 500%",
    items: organized.explosive,
  },
  {
    key: "fastRising",
    title: "快速上升",
    subtitle: "200-500%",
    items: organized.fastRising,
  },
  {
    key: "steadyRising",
    title: "稳定上升",
    subtitle: "100-200%",
    items: organized.steadyRising,
  },
  {
    key: "slowRising",
    title: "缓慢上升",
    subtitle: "< 100%",
    items: organized.slowRising,
  },
];

function PaginatedList<T>({
  items,
  renderItem,
  className,
  pageSize = 30,
  keyExtractor,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  className?: string;
  pageSize?: number;
  keyExtractor: (item: T) => string;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);

  const currentItems = items.slice((activePage - 1) * pageSize, activePage * pageSize);

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
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
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
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
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

export default function CandidatesPage() {
  const {
    expandData,
    selected,
    toggleCandidate,
    selectTop,
    selectAll,
    clearSelection,
    loadingCompare,
    handleCompare,
    compareProgress,
  } = useResearch();

  const [showSlow, setShowSlow] = useState(false);
  const [showFilteredOut, setShowFilteredOut] = useState(false);

  if (!expandData) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center animate-in fade-in">
        <div className="mb-4 h-12 w-12 text-muted-foreground/30">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold">暂无候选词数据</h3>
        <p className="mb-6 text-muted-foreground">请先回到第一步执行扩词。</p>
        <Link href="/dashboard/expand">
          <Button>前往第一步</Button>
        </Link>
      </div>
    );
  }

  const comparisonCost = formatUsd(countEstimate(selected.size));
  const comparePercent =
    compareProgress && compareProgress.total > 0
      ? Math.min(100, Math.round((compareProgress.ready / compareProgress.total) * 100))
      : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>第二步：人工筛选</CardTitle>
              <CardDescription>
                共 {expandData.flatList.length} 个候选词，请勾选需要进入趋势对比的关键词。
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => selectTop(20)}>
                Top 20
              </Button>
              <Button variant="outline" size="sm" onClick={selectAll}>
                全选
              </Button>
              <Button variant="outline" size="sm" onClick={clearSelection}>
                清空
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
              <input
                type="checkbox"
                className="rounded border-zinc-300 text-primary focus:ring-ring"
                checked={showSlow}
                onChange={(event) => setShowSlow(event.target.checked)}
              />
              显示缓慢上升词
            </label>

            {expandData.filteredOut && expandData.filteredOut.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
                <input
                  type="checkbox"
                  className="rounded border-zinc-300 text-primary focus:ring-ring"
                  checked={showFilteredOut}
                  onChange={(event) => setShowFilteredOut(event.target.checked)}
                />
                显示已过滤关键词（{expandData.filteredOut.length}）
              </label>
            )}
          </div>

          <div className="space-y-8">
            {mapOrganizedSections(expandData.organized)
              .filter((section) => showSlow || section.key !== "slowRising")
              .map((section) => (
                <div key={section.key} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-foreground">
                      {section.title}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {section.subtitle}
                      </span>
                    </h3>
                    <Badge variant="secondary" className="text-xs">
                      {section.items.length}
                    </Badge>
                  </div>

                  <PaginatedList
                    items={section.items}
                    pageSize={30}
                    className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                    keyExtractor={(item: Candidate) => `${section.key}-${item.keyword}`}
                    renderItem={(item: Candidate) => (
                      <div
                        className={cn(
                          "group relative flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm transition-all hover:bg-muted/50",
                          selected.has(item.keyword)
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "bg-card"
                        )}
                        onClick={() => toggleCandidate(item.keyword)}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300 text-primary focus:ring-ring"
                            checked={selected.has(item.keyword)}
                            readOnly
                          />
                          <span className="font-medium">{item.keyword}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Badge
                            variant={item.type === "rising" ? "default" : "secondary"}
                            className="h-5 px-1.5 text-[10px]"
                          >
                            {candidateTypeLabel(item.type)}
                          </Badge>
                          <span className="font-mono text-xs text-muted-foreground">
                            {Math.round(item.value)}%
                          </span>
                        </div>
                      </div>
                    )}
                  />

                  {section.items.length === 0 && (
                    <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
                      暂无数据
                    </div>
                  )}
                </div>
              ))}
          </div>

          {showFilteredOut && expandData.filteredOut && expandData.filteredOut.length > 0 && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
              <div className="mb-3 font-medium">已过滤关键词</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {expandData.filteredOut.map((item) => (
                  <div
                    key={`filtered-${item.keyword}-${item.source}`}
                    className="flex items-center justify-between rounded border border-destructive/20 bg-background px-3 py-2 text-xs opacity-70"
                  >
                    <span className="line-through">{item.keyword}</span>
                    <span>{item.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-3 border-t bg-muted/50 px-6 py-4">
          <div className="flex w-full items-center justify-between">
            <div className="text-sm text-muted-foreground">
              已选 <span className="font-medium text-foreground">{selected.size}</span> 个词，
              预计对比成本：{comparisonCost}
            </div>
            <div className="flex gap-3">
              <Link href="/dashboard/expand">
                <Button variant="outline">上一步</Button>
              </Link>
              <Button onClick={handleCompare} disabled={loadingCompare || selected.size === 0}>
                {loadingCompare && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loadingCompare ? "对比中..." : "开始趋势对比"}
              </Button>
            </div>
          </div>

          {loadingCompare && (
            <div className="w-full space-y-2 rounded-md border bg-background px-3 py-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>任务进度</span>
                {compareProgress?.total ? (
                  <span>
                    {compareProgress.ready}/{compareProgress.total} · {comparePercent}%
                  </span>
                ) : (
                  <span>准备中...</span>
                )}
              </div>
              <Progress value={comparePercent} />
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
