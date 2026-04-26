"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Key, Users, Activity, Gamepad2, Search, ListChecks, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ResearchProvider, useResearch } from "@/lib/context/research-context";

function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, handleSignOut } = useResearch();

  const ensureSessionBeforeNavigate = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json();
      if (!payload?.user) {
        event.preventDefault();
        router.replace("/login");
      }
    } catch {
      // Network hiccups should not block client-side navigation.
    }
  };

  // 学员菜单
  const studentSteps = [
    { href: "/dashboard/expand", label: "1. 词根扩展", active: pathname.includes("/expand") && !pathname.includes("/expand/") },
    { href: "/dashboard/candidates", label: "2. 候选筛选", active: pathname.includes("/candidates") },
    { href: "/dashboard/analysis", label: "3. 趋势对比", active: pathname.includes("/analysis") },
    { href: "/dashboard/games", label: "🎮 新游发现", icon: Gamepad2, active: pathname === "/dashboard/games" },
    { href: "/dashboard/old-keywords", label: "🔍 老词推荐", icon: Search, active: pathname === "/dashboard/old-keywords" },
    { href: "/dashboard/settings", label: "设置", icon: Settings, active: pathname.includes("/settings") },
  ];

  // 管理员菜单
  const adminSteps = [
    { href: "/dashboard/admin/health", label: "系统健康", icon: Activity, active: pathname.includes("/admin/health") },
    { href: "/dashboard/admin/codes", label: "邀请码管理", icon: Key, active: pathname.includes("/admin/codes") },
    { href: "/dashboard/admin/users", label: "用户管理", icon: Users, active: pathname.includes("/admin/users") },
    { href: "/dashboard/admin/games", label: "新游发现", icon: Gamepad2, active: pathname.includes("/admin/games") },
    { href: "/dashboard/admin/old-keywords", label: "老词挖掘", icon: Search, active: pathname.includes("/admin/old-keywords") },
    { href: "/dashboard/admin/pipeline-runs", label: "管线运行", icon: ListChecks, active: pathname.includes("/admin/pipeline-runs") },
  ];

  const isAdmin = (user as { role?: string } | null)?.role === "admin";

  const visibleStudentSteps = studentSteps.filter((step) => {
    // 管理员有自己的新游发现页(/admin/games)和老词页(/admin/old-keywords)，不重复显示学员版
    if (isAdmin && (step.href === "/dashboard/games" || step.href === "/dashboard/old-keywords")) return false;
    return true;
  });

  const renderNavLink = (step: (typeof studentSteps)[number] | (typeof adminSteps)[number]) => (
    <Link
      key={step.href}
      href={step.href}
      onClick={ensureSessionBeforeNavigate}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors hover:text-primary lg:px-3.5",
        step.active ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted"
      )}
    >
      {step.icon && <step.icon className="h-4 w-4 shrink-0" />}
      <span className="whitespace-nowrap">{step.label}</span>
    </Link>
  );

  return (
    <div className="sticky top-0 z-50 w-full border-b border-border/80 bg-background/90 shadow-sm shadow-black/5 backdrop-blur-xl dark:shadow-black/25">
      <div className="container mx-auto flex min-h-16 flex-col gap-3 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3 lg:flex-row lg:items-start">
          <Link href="/dashboard" className="flex shrink-0 items-center">
            <h1 className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-lg font-bold tracking-tight text-transparent dark:from-indigo-400 dark:to-violet-400 lg:w-24 lg:text-xl">
              关键词研究台
            </h1>
          </Link>

          <nav className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="hidden rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground lg:inline-flex">
                研究
              </span>
              {visibleStudentSteps.map(renderNavLink)}
            </div>

            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 lg:border-t-0 lg:pt-0">
                <span className="hidden rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground lg:inline-flex">
                  管理
                </span>
                {adminSteps.map(renderNavLink)}
              </div>
            )}
          </nav>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 pt-2 xl:justify-end xl:border-t-0 xl:pt-0">
          {user ? (
            <>
              <span className="max-w-[220px] truncate text-xs text-muted-foreground sm:max-w-[280px]">
                {user.email}
                {isAdmin && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">管理员</span>}
              </span>

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
      <div className="min-h-screen bg-background/40 pb-20">
        <Navigation />
        <main className="container mx-auto max-w-7xl px-4 py-8">{children}</main>
        <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-200/20 via-background to-background dark:from-indigo-500/10 dark:via-background dark:to-background" />
      </div>
    </ResearchProvider>
  );
}
