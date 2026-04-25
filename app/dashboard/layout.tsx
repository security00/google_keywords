"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Key, Users, Activity, Gamepad2, Search, ListChecks } from "lucide-react";

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
    { href: "/dashboard/settings", label: "设置", active: pathname.includes("/settings") },
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

  return (
    <div className="sticky top-0 z-50 w-full border-b border-border/80 bg-background/80 shadow-sm shadow-black/5 backdrop-blur-xl dark:shadow-black/25">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="hidden md:block">
            <h1 className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-xl font-bold tracking-tight text-transparent dark:from-indigo-400 dark:to-violet-400">
              关键词研究台
            </h1>
          </Link>

          <nav className="flex items-center gap-1">
            {/* 研究菜单 - 所有人都能看到 */}
            {studentSteps.filter(step => {
              // 管理员有自己的新游发现页(/admin/games)和老词页(/admin/old-keywords)，不重复显示学员版
              if (isAdmin && (step.href === "/dashboard/games" || step.href === "/dashboard/old-keywords")) return false;
              return true;
            }).map((step) => (
              <Link
                key={step.href}
                href={step.href}
                onClick={ensureSessionBeforeNavigate}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors hover:text-primary",
                  step.active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {step.icon && <step.icon className="h-4 w-4" />}
                {step.label}
              </Link>
            ))}

            {/* 管理员菜单 - 只有管理员能看到 */}
            {isAdmin && (
              <>
                <div className="mx-2 h-6 w-px bg-border" />
                {adminSteps.map((step) => (
                  <Link
                    key={step.href}
                    href={step.href}
                    onClick={ensureSessionBeforeNavigate}
                    className={cn(
                      "flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors hover:text-primary",
                      step.active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {step.icon && <step.icon className="h-4 w-4" />}
                    {step.label}
                  </Link>
                ))}
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <span className="hidden text-xs text-muted-foreground md:inline-block">
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
