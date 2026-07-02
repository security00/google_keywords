"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SessionUser = {
  id: string;
  email: string;
  role?: string;
};

export function MarketingAuthActions() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const response = await fetch("/api/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        setUser(response.ok && payload?.user ? payload.user : null);
      } catch {
        setUser(null);
      } finally {
        setLoaded(true);
      }
    };

    loadSession();
  }, []);

  if (!loaded) {
    return <div className="h-9 w-44" aria-hidden="true" />;
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-[220px] truncate text-sm font-medium text-zinc-600 md:inline-block">
          {user.email}
        </span>
        <Link
          href="/dashboard"
          className="whitespace-nowrap rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800"
        >
          Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/login"
        className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white hover:text-zinc-950"
      >
        Login
      </Link>
      <Link
        href="/register"
        className="whitespace-nowrap rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800"
      >
        Request access
      </Link>
    </div>
  );
}
