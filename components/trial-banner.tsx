"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trackGaEvent } from "@/lib/analytics";

type AccessPayload = {
  entitlement?: { source?: string };
  trial?: { active?: boolean; daysLeft?: number };
};

export function TrialBanner() {
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/auth/access", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as AccessPayload;
        const remaining = payload.trial?.daysLeft;
        if (
          payload.entitlement?.source === "course" &&
          payload.trial?.active &&
          typeof remaining === "number" &&
          Number.isFinite(remaining)
        ) {
          setDaysLeft(remaining);
          if (remaining <= 7) {
            trackGaEvent("trial_expiring_view", { days_left: remaining });
          }
        }
      } catch {
        // Banner is optional; a failed access check should not block the dashboard.
      }
    };

    load();
  }, []);

  if (daysLeft === null) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="container mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
        <span>试用剩余 {daysLeft} 天</span>
        <Link href="/dashboard/settings" className="font-medium underline underline-offset-4">
          Subscribe
        </Link>
      </div>
    </div>
  );
}
