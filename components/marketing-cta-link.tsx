"use client";

import Link from "next/link";
import { trackGaEvent } from "@/lib/analytics";

export function MarketingCtaLink({
  href,
  location,
  className,
  children,
}: {
  href: string;
  location: "header" | "hero" | "solution" | "footer";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => trackGaEvent("marketing_cta_click", { location, href })}
    >
      {children}
    </Link>
  );
}
