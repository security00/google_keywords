import Link from "next/link";
import { Radar } from "lucide-react";
import { MarketingAuthActions } from "@/components/marketing-auth-actions";
import { MarketingCtaLink } from "@/components/marketing-cta-link";
import { publicSignupCta } from "@/lib/public-signup";

export const solutionLinks = [
  { href: "/keyword-opportunity-platform", label: "Opportunity platform" },
  { href: "/seo-signal-discovery", label: "Signal discovery" },
  { href: "/programmatic-seo-keyword-research", label: "Programmatic SEO" },
  { href: "/game-keyword-research", label: "Game keywords" },
  { href: "/ai-keyword-research", label: "AI keywords" },
];

const navLinks = [
  { href: "/#product", label: "Product" },
  { href: "/#workflow", label: "Workflow" },
  { href: "/#case-studies", label: "Cases" },
  { href: "/pricing", label: "Pricing" },
  { href: "/api-docs", label: "Docs" },
];

const footerProductLinks = [
  { href: "/#product", label: "Product" },
  { href: "/#workflow", label: "Workflow" },
  { href: "/#case-studies", label: "Case studies" },
  { href: "/pricing", label: "Pricing" },
];

const footerResourceLinks = [
  { href: "/api-docs", label: "API docs" },
  { href: "/#faq", label: "FAQ" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/login", label: "Login", tracked: true },
  { href: "/register", label: publicSignupCta(), tracked: true },
];

function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span
      className={`flex items-center justify-center rounded-full bg-gradient-to-br from-[#635bff] to-[#0073e6] text-white shadow-lg shadow-[#635bff]/25 ${className}`}
    >
      <Radar className="h-[55%] w-[55%]" aria-hidden="true" />
    </span>
  );
}

export function MarketingHeader() {
  return (
    <header className="sticky top-3 z-40 px-3 sm:top-4 sm:px-4">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 rounded-full border border-[#e6ebf1] bg-white/80 py-2 pl-3 pr-2 shadow-[0_2px_12px_-2px_rgba(10,37,64,0.08),0_12px_32px_-8px_rgba(10,37,64,0.10)] backdrop-blur-xl">
        <Link
          href="/"
          className="flex flex-none items-center gap-2.5 rounded-full text-sm font-semibold tracking-tight text-[#0a2540]"
        >
          <LogoMark />
          <span className="sm:hidden">Discover</span>
          <span className="hidden sm:inline">Discover Keywords</span>
        </Link>
        <nav className="hidden items-center gap-0.5 text-sm font-medium text-[#425466] lg:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3.5 py-1.5 transition hover:bg-[#f6f9fc] hover:text-[#0a2540]"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <MarketingAuthActions />
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-[#e6ebf1] bg-[#f6f9fc] text-sm text-[#425466]">
      <div aria-hidden="true" className="absolute inset-0">
        <div className="mk-grid-light mk-fade-top absolute inset-0 opacity-60" />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-10 pt-16 sm:px-6 lg:px-8 lg:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <Link href="/" className="flex w-fit items-center gap-2.5 text-base font-semibold tracking-tight text-[#0a2540]">
              <LogoMark className="h-9 w-9" />
              Discover Keywords
            </Link>
            <p className="mt-5 max-w-sm text-base leading-7 text-[#425466]">
              Reviewed keyword opportunity discovery for indie hackers, tool-site operators, and SEO teams.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#e6ebf1] bg-white px-3.5 py-1.5 text-xs font-medium text-[#425466] shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="mk-signal-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Fresh opportunities reviewed weekly
            </div>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            <FooterColumn title="Product" links={footerProductLinks} />
            <FooterColumn title="Solutions" links={solutionLinks} />
            <FooterColumn title="Resources" links={footerResourceLinks} />
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-2 border-t border-[#e6ebf1] pt-6 text-xs text-[#6b7c93] sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Discover Keywords. All rights reserved.</p>
          <p>Find buildable keyword opportunities before the market sees them.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string; tracked?: boolean }>;
}) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7c93]">{title}</h3>
      <div className="mt-4 grid gap-2.5">
        {links.map((link) =>
          link.tracked ? (
            <MarketingCtaLink
              key={`${title}-${link.href}`}
              href={link.href}
              location="footer"
              className="w-fit transition hover:text-[#0a2540]"
            >
              {link.label}
            </MarketingCtaLink>
          ) : (
            <Link key={`${title}-${link.href}`} href={link.href} className="w-fit transition hover:text-[#0a2540]">
              {link.label}
            </Link>
          )
        )}
      </div>
    </div>
  );
}
