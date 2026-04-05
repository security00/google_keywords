"use client";

import { Loader2 } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_KEYWORDS,
  TASK_COST_USD,
  formatUsd,
  useResearch,
} from "@/lib/context/research-context";

export default function ExpandPage() {
  const {
    keywordsText,
    setKeywordsText,
    useCache,
    setUseCache,
    includeTop,
    setIncludeTop,
    useModelFilter,
    setUseModelFilter,
    filterTermsText,
    setFilterTermsText,
    filterPrompt,
    setFilterPrompt,
    loadingExpand,
    handleExpand,
    expandProgress,
    effectiveKeywords,
    expandData,
  } = useResearch();

  const expansionCost = formatUsd(effectiveKeywords.length * TASK_COST_USD);
  const expandPercent =
    expandProgress && expandProgress.total > 0
      ? Math.min(100, Math.round((expandProgress.ready / expandProgress.total) * 100))
      : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>第一步：词根扩展</CardTitle>
              <CardDescription>
                设置种子词和过滤条件，系统会基于趋势相关词生成候选关键词。
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground">
                <input
                  type="checkbox"
                  className="rounded border-zinc-300 text-primary focus:ring-ring"
                  checked={useCache}
                  onChange={(event) => setUseCache(event.target.checked)}
                />
                使用缓存
              </label>
              <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground">
                <input
                  type="checkbox"
                  className="rounded border-zinc-300 text-primary focus:ring-ring"
                  checked={includeTop}
                  onChange={(event) => setIncludeTop(event.target.checked)}
                />
                保留 Top 词
              </label>
              <label className="flex cursor-pointer items-center gap-2 transition-colors hover:text-foreground">
                <input
                  type="checkbox"
                  className="rounded border-zinc-300 text-primary focus:ring-ring"
                  checked={useModelFilter}
                  onChange={(event) => setUseModelFilter(event.target.checked)}
                />
                启用语义过滤
              </label>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            预计成本：
            <span className="ml-1 font-medium text-foreground">{expansionCost}</span>
            <span className="ml-1 text-xs">
              （{effectiveKeywords.length} 个词根 × {formatUsd(TASK_COST_USD)}）
            </span>
          </div>

          {useModelFilter && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>黑名单主题</Label>
                <Textarea
                  className="min-h-[80px]"
                  placeholder="输入要排除的主题，例如：博彩、影视、新闻、登录页"
                  value={filterTermsText}
                  onChange={(event) => setFilterTermsText(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>补充过滤提示</Label>
                <Textarea
                  className="min-h-[80px]"
                  placeholder="可选。用于补充模型过滤规则，例如：排除所有资讯聚合页和品牌词"
                  value={filterPrompt}
                  onChange={(event) => setFilterPrompt(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>核心词根</Label>
            <Textarea
              className="min-h-[120px] font-mono text-sm"
              placeholder="输入词根，支持逗号、空格、换行分隔"
              value={keywordsText}
              onChange={(event) => setKeywordsText(event.target.value)}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>默认词根：{DEFAULT_KEYWORDS.slice(0, 5).join(", ")}...</span>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-3 border-t bg-muted/50 px-6 py-4">
          <div className="flex w-full items-center justify-between">
            {expandData?.fromCache ? (
              <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-50 text-emerald-700"
              >
                已加载缓存结果
              </Badge>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-4">
              {expandData?.filter && (
                <span className="text-xs text-muted-foreground">
                  已过滤 {expandData.filter.removed} 个无效词
                </span>
              )}
              <Button onClick={handleExpand} disabled={loadingExpand}>
                {loadingExpand && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loadingExpand ? "扩展中..." : "获取候选词"}
              </Button>
            </div>
          </div>

          {loadingExpand && (
            <div className="w-full space-y-2 rounded-md border bg-background px-3 py-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>任务进度</span>
                {expandProgress?.total ? (
                  <span>
                    {expandProgress.ready}/{expandProgress.total} · {expandPercent}%
                  </span>
                ) : (
                  <span>准备中...</span>
                )}
              </div>
              <Progress value={expandPercent} />
            </div>
          )}
        </CardFooter>
      </Card>

      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        点击“获取候选词”后，系统会完成扩词并自动进入下一步筛选。
      </div>
    </div>
  );
}
