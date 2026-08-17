import Link from "next/link";
import { Sparkles } from "lucide-react";
import { MarketingAuthActions } from "@/components/marketing-auth-actions";
import { publicSignupCta } from "@/lib/public-signup";

export const solutionLinks = [
  { href: "/keyword-opportunity-platform", label: "Opportunity platform" },
  { href: "/seo-signal-discovery", label: "Signal discovery" },
  { href: "/programmatic-seo-keyword-research", label: "Programmatic SEO" },
  { href: "/game-keyword-research", label: "Game keywords" },
  { href: "/ai-keyword-research", label: "AI keywords" },
];

const productLinks = [
  { href: "/#product", label: "Product" },
  { href: "/#workflow", label: "Workflow" },
  { href: "/dashboard/opportunities", label: "Opportunity Radar" },
];

const resourceLinks = [
  { href: "/api-docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
  { href: "/dashboard", label: "Dashboard" },
];

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex flex-none items-center gap-2 text-sm font-semibold text-slate-950">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-950 text-white shadow-sm">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="sm:hidden">Discover</span>
          <span className="hidden sm:inline">Discover Keywords</span>
        </Link>
        <nav className="hidden items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1 text-sm font-medium text-slate-600 lg:flex">
          <Link href="/#product" className="rounded-full px-3 py-1.5 hover:bg-white hover:text-slate-950">
            Product
          </Link>
          <Link href="/#solutions" className="rounded-full px-3 py-1.5 hover:bg-white hover:text-slate-950">
            Solutions
          </Link>
          <Link href="/pricing" className="rounded-full px-3 py-1.5 hover:bg-white hover:text-slate-950">
            Pricing
          </Link>
          <Link href="/api-docs" className="rounded-full px-3 py-1.5 hover:bg-white hover:text-slate-950">
            Docs
          </Link>
        </nav>
        <MarketingAuthActions />
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 text-sm text-slate-600 sm:px-6 md:grid-cols-[1.2fr_2fr] lg:px-8">
        <div>
          <Link href="/" className="font-semibold text-slate-950">
            Discover Keywords
          </Link>
          <p className="mt-3 max-w-sm leading-6">
            Reviewed keyword opportunity discovery for SaaS builders, SEO operators, and tool-site teams.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          <FooterColumn title="Product" links={productLinks} />
          <FooterColumn title="Solutions" links={solutionLinks} />
          <FooterColumn
            title="Company"
            links={[
              ...resourceLinks,
              { href: "/login", label: "Login" },
              { href: "/register", label: publicSignupCta() },
            ]}
          />
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-950">{title}</h3>
      <div className="mt-3 grid gap-2.5">
        {links.map((link) => (
          <Link key={`${title}-${link.href}`} href={link.href} className="hover:text-slate-950">
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
