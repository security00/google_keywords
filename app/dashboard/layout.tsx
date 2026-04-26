"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Key, Users, Activity, Gamepad2, Search, ListChecks, Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ResearchProvider, useResearch } from "@/lib/context/research-context";

function Navigation({
  isSidebarCollapsed,
  setIsSidebarCollapsed,
}: {
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}) {
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
    { href: "/dashboard/games", label: "新游发现", icon: Gamepad2, active: pathname === "/dashboard/games" },
    { href: "/dashboard/old-keywords", label: "老词推荐", icon: Search, active: pathname === "/dashboard/old-keywords" },
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

  const renderTopNavLink = (step: (typeof studentSteps)[number]) => (
    <Link
      key={step.href}
      href={step.href}
      onClick={ensureSessionBeforeNavigate}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors hover:text-primary",
        step.active ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted"
      )}
    >
      {step.icon && <step.icon className="h-4 w-4 shrink-0" />}
      <span className="whitespace-nowrap">{step.label}</span>
    </Link>
  );

  const renderSidebarLink = (step: (typeof studentSteps)[number] | (typeof adminSteps)[number]) => (
    <Link
      key={step.href}
      href={step.href}
      onClick={ensureSessionBeforeNavigate}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        isSidebarCollapsed && "justify-center px-2",
        step.active ? "bg-primary/10 text-primary shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {step.icon && <step.icon className="h-4 w-4 shrink-0" />}
      <span className={cn(isSidebarCollapsed && "sr-only")}>{step.label}</span>
    </Link>
  );

  if (isAdmin) {
    return (
      <>
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 hidden border-r border-border/80 bg-background/95 px-3 py-4 shadow-sm shadow-black/5 backdrop-blur-xl transition-[width] duration-200 lg:block dark:shadow-black/25",
            isSidebarCollapsed ? "w-20" : "w-60"
          )}
        >
          <div className={cn("mb-6 flex items-start gap-2", isSidebarCollapsed ? "justify-center" : "justify-between")}>
            <Link href="/dashboard" className={cn("min-w-0 px-2", isSidebarCollapsed && "sr-only")}>
              <h1 className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-xl font-bold tracking-tight text-transparent dark:from-indigo-400 dark:to-violet-400">
                关键词研究台
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">Admin Console</p>
            </Link>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
              title={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
              className="h-9 w-9 shrink-0 px-0"
              onClick={() => setIsSidebarCollapsed((value) => !value)}
            >
              {isSidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
          </div>

          <nav className="space-y-5">
            <div>
              <p className={cn("mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80", isSidebarCollapsed && "sr-only")}>研究功能</p>
              <div className="space-y-1">{visibleStudentSteps.map(renderSidebarLink)}</div>
            </div>

            <div>
              <p className={cn("mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80", isSidebarCollapsed && "sr-only")}>管理后台</p>
              <div className="space-y-1">{adminSteps.map(renderSidebarLink)}</div>
            </div>
          </nav>
        </aside>

        <header
          className={cn(
            "sticky top-0 z-40 border-b border-border/80 bg-background/90 shadow-sm shadow-black/5 backdrop-blur-xl transition-[margin] duration-200 dark:shadow-black/25",
            isSidebarCollapsed ? "lg:ml-20" : "lg:ml-60"
          )}
        >
          <div className="container mx-auto flex min-h-14 items-center justify-between gap-3 px-4">
            <Link href="/dashboard" className="lg:hidden">
              <h1 className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-lg font-bold tracking-tight text-transparent dark:from-indigo-400 dark:to-violet-400">
                关键词研究台
              </h1>
            </Link>

            <nav className="hidden min-w-0 flex-1 items-center gap-2 overflow-x-auto lg:flex">
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">管理员后台</span>
              <span className="text-sm text-muted-foreground">{pathname.startsWith("/dashboard/admin") ? "管理功能" : "研究功能"}</span>
            </nav>

            <div className="flex min-w-0 shrink-0 items-center gap-2">
              {user ? (
                <>
                  <span className="max-w-[180px] truncate text-xs text-muted-foreground sm:max-w-[260px]">
                    {user.email}
                    <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">管理员</span>
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

          <nav className="flex gap-2 overflow-x-auto border-t border-border/60 px-4 py-2 lg:hidden">
            {[...visibleStudentSteps, ...adminSteps].map(renderTopNavLink)}
          </nav>
        </header>
      </>
    );
  }

  return (
    <div className="sticky top-0 z-50 w-full border-b border-border/80 bg-background/90 shadow-sm shadow-black/5 backdrop-blur-xl dark:shadow-black/25">
      <div className="container mx-auto flex min-h-16 items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-6">
          <Link href="/dashboard" className="hidden shrink-0 md:block">
            <h1 className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-xl font-bold tracking-tight text-transparent dark:from-indigo-400 dark:to-violet-400">
              关键词研究台
            </h1>
          </Link>

          <nav className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            {visibleStudentSteps.map(renderTopNavLink)}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {user ? (
            <>
              <span className="hidden max-w-[260px] truncate text-xs text-muted-foreground md:inline-block">
                {user.email}
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
      <DashboardShell>{children}</DashboardShell>
    </ResearchProvider>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user } = useResearch();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const isAdmin = (user as { role?: string } | null)?.role === "admin";

  return (
    <div className="min-h-screen bg-background/40 pb-20">
      <Navigation isSidebarCollapsed={isSidebarCollapsed} setIsSidebarCollapsed={setIsSidebarCollapsed} />
      <main
        className={cn(
          "container mx-auto max-w-7xl px-4 py-8 transition-[padding] duration-200",
          isAdmin && "lg:max-w-none lg:pr-8",
          isAdmin && (isSidebarCollapsed ? "lg:pl-[7rem]" : "lg:pl-[17rem]")
        )}
      >
        {children}
      </main>
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-200/20 via-background to-background dark:from-indigo-500/10 dark:via-background dark:to-background" />
    </div>
  );
}
