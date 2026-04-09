"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Key, Users, ArrowLeft, ShieldAlert } from "lucide-react";

const nav = [
  { href: "/admin/codes", label: "邀请码管理", icon: Key },
  { href: "/admin/users", label: "用户管理", icon: Users },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth/access")
      .then((r) => r.json())
      .then((data) => {
        if (data.role === "admin") {
          setIsAdmin(true);
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">验证权限中...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <ShieldAlert className="h-12 w-12 text-red-500" />
        <h2 className="text-xl font-bold">访问被拒绝</h2>
        <p className="text-muted-foreground">仅管理员可访问此页面</p>
        <Link href="/dashboard" className="text-sm text-blue-500 hover:underline">返回工作台</Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* 侧边栏 */}
      <aside className="hidden w-56 shrink-0 border-r bg-muted/30 md:block">
        <div className="p-4">
          <Link href="/dashboard" className="mb-6 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            返回工作台
          </Link>
          <h2 className="mb-4 text-sm font-semibold uppercase text-muted-foreground">管理后台</h2>
          <nav className="space-y-1">
            {nav.map((item) => {
              const active = pathname.includes(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
