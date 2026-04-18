"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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

  return <>{children}</>;
}
