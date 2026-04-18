"use client";

import { Loader2 } from "lucide-react";

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
    filterTermsText,
    setFilterTermsText,
    filterPrompt,
    setFilterPrompt,
    loadingExpand,
    handleExpand,
    expandProgress,
    effectiveKeywords,
    expandData,
    error,
    debugLogs,
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
          <div>
            <CardTitle>第一步：词根扩展</CardTitle>
            <CardDescription>
              设置种子词和过滤条件，系统会基于趋势相关词生成候选关键词。
            </CardDescription>
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
          {error && (
            <div className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex w-full items-center justify-between">
            <div />
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

      {debugLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近日志</CardTitle>
            <CardDescription>用于定位扩词流程停在了哪一步。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {debugLogs.slice(0, 8).map((entry) => (
              <div key={entry.id} className="rounded-md border px-3 py-2">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium">{entry.title}</span>
                  <span className="text-xs text-muted-foreground">{entry.at}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  [{entry.level}] {entry.details ?? ""}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
