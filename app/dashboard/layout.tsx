"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ResearchProvider, useResearch } from "@/lib/context/research-context";

function formatUtcDateTime(value?: string | null): string {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function Navigation() {
  const pathname = usePathname();
  const { user, handleSignOut, loadLatestSession, loadSessionById, sessionList } = useResearch();
  const [selectedSession, setSelectedSession] = useState("latest");

  const sessionOptions = useMemo(() => {
    return sessionList.map((session) => {
      const createdLabel = session.created_at
        ? formatUtcDateTime(session.created_at)
        : "未知时间";
      const title =
        session.title?.trim() ||
        session.keywords?.slice(0, 3).join(", ") ||
        "未命名会话";

      return {
        id: session.id,
        label: `${title} · ${createdLabel}`,
      };
    });
  }, [sessionList]);

  const steps = [
    { href: "/dashboard/expand", label: "1. 词根扩展", active: pathname.includes("/expand") },
    { href: "/dashboard/candidates", label: "2. 候选筛选", active: pathname.includes("/candidates") },
    { href: "/dashboard/analysis", label: "3. 趋势对比", active: pathname.includes("/analysis") },
    { href: "/dashboard/discovery", label: "新游发现", active: pathname.includes("/discovery") },
    { href: "/dashboard/settings", label: "设置", active: pathname.includes("/settings") },
  ];

  return (
    <div className="sticky top-0 z-50 w-full border-b border-white/20 bg-white/70 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/70">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="hidden md:block">
            <h1 className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-xl font-bold tracking-tight text-transparent dark:from-indigo-400 dark:to-violet-400">
              关键词研究台
            </h1>
          </Link>

          <nav className="flex items-center gap-1">
            {steps.map((step) => (
              <Link
                key={step.href}
                href={step.href}
                className={cn(
                  "relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors hover:text-primary",
                  step.active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {step.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <span className="hidden text-xs text-muted-foreground md:inline-block">
                {user.email}
              </span>

              <div className="flex items-center gap-2">
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={selectedSession}
                  onChange={(event) => setSelectedSession(event.target.value)}
                >
                  <option value="latest">最近一次</option>
                  {sessionOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    selectedSession === "latest"
                      ? loadLatestSession()
                      : loadSessionById(selectedSession)
                  }
                >
                  恢复
                </Button>
              </div>

              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                退出
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">检查登录状态...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ResearchProvider>
      <div className="min-h-screen bg-muted/10 pb-20">
        <Navigation />
        <main className="container mx-auto max-w-7xl px-4 py-8">{children}</main>
        <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100/20 via-background to-background dark:from-indigo-950/20" />
      </div>
    </ResearchProvider>
  );
}
