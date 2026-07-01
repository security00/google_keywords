import Link from "next/link";
import { Sparkles } from "lucide-react";

const solutionLinks = [
  { href: "/keyword-opportunity-platform", label: "Opportunity platform" },
  { href: "/seo-signal-discovery", label: "Signal discovery" },
  { href: "/programmatic-seo-keyword-research", label: "Programmatic SEO" },
];

export function MarketingHeader() {
  return (
    <header className="border-b border-zinc-200/80 bg-[#f7f7f2]/95">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          Discover Keywords
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-zinc-600 lg:flex">
          <Link href="/#workflow" className="hover:text-zinc-950">
            Workflow
          </Link>
          <Link href="/#solutions" className="hover:text-zinc-950">
            Solutions
          </Link>
          <Link href="/api-docs" className="hover:text-zinc-950">
            API docs
          </Link>
        </nav>
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
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-zinc-200 bg-[#f7f7f2]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-zinc-600 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <Link href="/" className="font-semibold text-zinc-950">
          Discover Keywords
        </Link>
        <div className="flex flex-wrap gap-4">
          {solutionLinks.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-zinc-950">
              {link.label}
            </Link>
          ))}
          <Link href="/api-docs" className="hover:text-zinc-950">
            API docs
          </Link>
          <Link href="/login" className="hover:text-zinc-950">
            Login
          </Link>
          <Link href="/register" className="hover:text-zinc-950">
            Register
          </Link>
          <Link href="/dashboard" className="hover:text-zinc-950">
            Dashboard
          </Link>
        </div>
      </div>
    </footer>
  );
}
