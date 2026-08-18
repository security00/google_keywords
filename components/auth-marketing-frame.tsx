"use client";

import Link from "next/link";

export function AuthMarketingFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Link
        href="/"
        className="absolute left-4 top-4 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        ← Discover Keywords
      </Link>
      {children}
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100/50 via-background to-background dark:from-indigo-950/20" />
    </div>
  );
}
