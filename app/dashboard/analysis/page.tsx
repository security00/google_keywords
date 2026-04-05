"use client";

import { useResearch } from "@/lib/context/research-context";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComparisonResultsCard } from "@/components/comparison-results";
import { cn } from "@/lib/utils";

export default function AnalysisPage() {
    const { compareData, debugLogs, logToConsole, setLogToConsole, setDebugLogs } = useResearch();

    if (!compareData) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center animate-in fade-in">
                <div className="mb-4 h-12 w-12 text-muted-foreground/30">
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                </div>
                <h3 className="text-lg font-semibold">暂无对比数据</h3>
                <p className="text-muted-foreground mb-6">请在第二步中选择关键词并开始对比。</p>
                <Link href="/dashboard/candidates">
                    <Button>前往第二步</Button>
                </Link>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <ComparisonResultsCard
                compareData={compareData}
                showDetails
                backHref="/dashboard/candidates"
            />

            {/* Logs Section (Shared) */}
            <Card>
                <CardHeader className="py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <CardTitle className="text-base">调试日志</CardTitle>
                        <div className="flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                                <input
                                    type="checkbox"
                                    className="rounded border-zinc-300 text-primary focus:ring-ring"
                                    checked={logToConsole}
                                    onChange={(event) => setLogToConsole(event.target.checked)}
                                />
                                输出到控制台
                            </label>
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDebugLogs([])}>
                                清空日志
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="mt-0 max-h-64 space-y-2 overflow-auto rounded-md border bg-muted/30 p-3 text-xs font-mono text-muted-foreground">
                        {debugLogs.length === 0 && (
                            <div className="text-center py-4 opacity-50">暂无日志</div>
                        )}
                        {debugLogs.map((entry) => (
                            <div
                                key={entry.id}
                                className="flex flex-col gap-1 border-b border-dashed border-border/50 pb-2 last:border-0 last:pb-0"
                            >
                                <div className="flex items-start gap-2">
                                    <span className="opacity-50 shrink-0">{entry.at}</span>
                                    <span
                                        className={cn(
                                            "break-all",
                                            entry.level === "error"
                                                ? "text-destructive font-medium"
                                                : entry.level === "success"
                                                    ? "text-emerald-600 font-medium"
                                                    : "text-foreground"
                                        )}
                                    >
                                        {entry.title}
                                    </span>
                                </div>
                                {entry.details && (
                                    <div className="pl-14 opacity-70 break-all whitespace-pre-wrap">{entry.details}</div>
                                )}
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
