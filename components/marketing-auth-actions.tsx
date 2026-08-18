"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MarketingCtaLink } from "@/components/marketing-cta-link";
import { publicSignupCta } from "@/lib/public-signup";

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
    return <div className="h-9 w-32 sm:w-44" aria-hidden="true" />;
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-[220px] truncate text-sm font-medium text-[#6b7c93] md:inline-block">
          {user.email}
        </span>
        <Link
          href="/dashboard"
          className="whitespace-nowrap rounded-full bg-[#0a2540] px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-[#0a2540]/15 transition hover:bg-[#12315a] sm:px-4 sm:text-sm"
        >
          Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <MarketingCtaLink
        href="/login"
        location="header"
        className="whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium text-[#425466] transition hover:bg-[#f6f9fc] hover:text-[#0a2540] sm:px-3.5 sm:text-sm"
      >
        Login
      </MarketingCtaLink>
      <MarketingCtaLink
        href="/register"
        location="header"
        className="whitespace-nowrap rounded-full bg-[#0a2540] px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-[#0a2540]/15 transition hover:bg-[#12315a] sm:px-4 sm:text-sm"
      >
        {publicSignupCta()}
      </MarketingCtaLink>
    </div>
  );
}
