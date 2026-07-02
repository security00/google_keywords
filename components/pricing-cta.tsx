"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

export function PricingCheckoutButton({
  className = "",
  label = "Start with Founding Member",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const startCheckout = async () => {
    setLoading(true);
    setError("");
    try {
      const sessionResponse = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      const sessionPayload = await sessionResponse.json().catch(() => ({}));
      if (!sessionPayload?.user) {
        router.push("/login?next=/pricing&checkout=founding");
        return;
      }

      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || typeof payload.url !== "string") {
        throw new Error(payload?.error || "Unable to start checkout");
      }
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start checkout");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={startCheckout}
        disabled={loading}
        className={className || "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:opacity-60"}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {label}
        {!loading ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
      </button>
      {error ? <p className="mt-2 text-sm font-medium text-red-600">{error}</p> : null}
    </div>
  );
}

export function PricingAutoCheckout() {
  const searchParams = useSearchParams();
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (started || searchParams.get("checkout") !== "founding") return;
      setStarted(true);
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && typeof payload.url === "string") {
        window.location.href = payload.url;
      }
    };

    run();
  }, [searchParams, started]);

  return null;
}
