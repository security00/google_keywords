import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  Gauge,
  Layers3,
  LineChart,
  LockKeyhole,
  Radar,
  SearchCheck,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export const dynamic = "force-static";

const workflow = [
  {
    label: "Collect",
    title: "Multi-source signals",
    text: "Watch Hacker News, Reddit, RSS feeds, game sources, and curated product signals without sending students into paid APIs.",
    icon: Radar,
  },
  {
    label: "Review",
    title: "Human-safe screening",
    text: "Filter news, celebrity, sports, trademark, and short-lived noise before anything reaches the opportunity pipeline.",
    icon: ShieldCheck,
  },
  {
    label: "Validate",
    title: "Trend and SERP checks",
    text: "Use trend movement, search intent, SERP shape, CPC, and difficulty to separate real opportunities from noisy spikes.",
    icon: SearchCheck,
  },
  {
    label: "Act",
    title: "Buildable keyword briefs",
    text: "Turn approved signals into candidate lists, game opportunities, and research sessions your team can actually use.",
    icon: CheckCircle2,
  },
];

const useCases = [
  {
    text: "Find new tool-site keywords before they show up in crowded keyword databases.",
    href: "/keyword-opportunity-platform",
  },
  {
    text: "Turn noisy SEO signals into reviewed keyword candidates.",
    href: "/seo-signal-discovery",
  },
  {
    text: "Prioritize programmatic SEO pages from reviewed demand patterns.",
    href: "/programmatic-seo-keyword-research",
  },
  {
    text: "Give students a stable shared-cache experience without accidental paid calls.",
    href: "/api-docs",
  },
];

const solutionPages = [
  {
    title: "Keyword opportunity platform",
    href: "/keyword-opportunity-platform",
    text: "How reviewed signals become buildable keyword opportunities before crowded tools expose them.",
  },
  {
    title: "SEO signal discovery",
    href: "/seo-signal-discovery",
    text: "How multi-source signals are collected, filtered, reviewed, and bridged into research workflows.",
  },
  {
    title: "Programmatic SEO keyword research",
    href: "/programmatic-seo-keyword-research",
    text: "How operators can prioritize repeatable page patterns for tools, templates, game pages, and clusters.",
  },
];

const proofCards = [
  {
    keyword: "browser extension generator",
    source: "HN + RSS",
    score: "82",
    reason: "Tool intent, rising signal, buildable page angle",
  },
  {
    keyword: "roblox clicker game",
    source: "Game radar",
    score: "76",
    reason: "Game relevance, SERP fit, trend checked",
  },
  {
    keyword: "pricing calculator template",
    source: "Reddit",
    score: "69",
    reason: "Founder workflow, clear utility intent",
  },
];

const stats = [
  { label: "Signal layers", value: "5+" },
  { label: "Review gates", value: "3" },
  { label: "Student paid calls", value: "0" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f7f2] text-zinc-950">
      <header className="border-b border-zinc-200/80 bg-[#f7f7f2]/95">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950 text-white">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            Discover Keywords
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-zinc-600 md:flex">
            <a href="#workflow" className="hover:text-zinc-950">
              Workflow
            </a>
            <a href="#solutions" className="hover:text-zinc-950">
              Solutions
            </a>
            <a href="#use-cases" className="hover:text-zinc-950">
              Use cases
            </a>
            <a href="#access" className="hover:text-zinc-950">
              Access
            </a>
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

      <section className="border-b border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[1fr_520px] lg:px-8 lg:py-20">
          <div className="flex flex-col justify-center">
            <div className="mb-5 flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
              <Gauge className="h-4 w-4" aria-hidden="true" />
              Keyword discovery with review gates
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl lg:text-6xl">
              Find keyword opportunities before they become obvious.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-600">
              Discover Keywords turns multi-platform signals into reviewed, trend-checked, and SERP-aware keyword
              opportunities for tool sites, game sites, and SEO operators.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800"
              >
                Request access
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/api-docs"
                className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-900 hover:border-zinc-400"
              >
                View API docs
              </Link>
            </div>
            <div className="mt-5 flex flex-wrap gap-3 text-sm font-semibold text-zinc-700">
              <Link href="/keyword-opportunity-platform" className="hover:text-emerald-700">
                Keyword opportunity platform
              </Link>
              <span className="text-zinc-300">/</span>
              <Link href="/seo-signal-discovery" className="hover:text-emerald-700">
                SEO signal discovery
              </Link>
              <span className="text-zinc-300">/</span>
              <Link href="/programmatic-seo-keyword-research" className="hover:text-emerald-700">
                Programmatic SEO research
              </Link>
            </div>
            <div className="mt-8 grid max-w-xl grid-cols-3 gap-3">
              {stats.map((item) => (
                <div key={item.label} className="rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="text-2xl font-semibold text-zinc-950">{item.value}</div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section id="workflow" className="bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Workflow</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
              A guarded pipeline from signal to usable keyword.
            </h2>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              The homepage is public, but the product remains controlled: review queues, dashboards, and API access
              stay behind existing authentication.
            </p>
          </div>
          <div className="mt-9 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflow.map((step) => (
              <div key={step.title} className="rounded-lg border border-zinc-200 bg-[#fbfbf8] p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{step.label}</span>
                  <step.icon className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-zinc-950">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="solutions" className="border-y border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Solution pages</p>
              <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
                Explore the public SEO pages.
              </h2>
              <p className="mt-4 text-base leading-7 text-zinc-600">
                These pages explain the product from different search intents and give crawlers clear internal paths
                into the new keyword discovery content.
              </p>
            </div>
            <Link href="/api-docs" className="text-sm font-semibold text-zinc-900 hover:text-emerald-700">
              API docs
            </Link>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {solutionPages.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className="group rounded-lg border border-zinc-200 bg-white p-5 hover:border-emerald-300"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xl font-semibold text-zinc-950">{page.title}</h3>
                  <ArrowRight className="h-5 w-5 flex-none text-zinc-400 group-hover:text-emerald-700" aria-hidden="true" />
                </div>
                <p className="mt-4 text-sm leading-6 text-zinc-600">{page.text}</p>
                <span className="mt-5 inline-flex text-sm font-semibold text-emerald-700">Open page</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="bg-white">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[420px_1fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Use cases</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
              Built for operators who need decisions, not another exported spreadsheet.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {useCases.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex gap-3 rounded-lg border border-zinc-200 bg-white p-4 hover:border-emerald-300"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-700" aria-hidden="true" />
                <p className="text-sm leading-6 text-zinc-600">{item.text}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-200 bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Reviewed samples</p>
              <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
                Show the idea without exposing internal data.
              </h2>
            </div>
            <Link href="/dashboard" className="text-sm font-semibold text-zinc-900 hover:text-emerald-700">
              Go to dashboard
            </Link>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {proofCards.map((item) => (
              <div key={item.keyword} className="rounded-lg border border-zinc-200 bg-[#fbfbf8] p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">
                    {item.source}
                  </span>
                  <span className="text-sm font-semibold text-zinc-950">Score {item.score}</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold text-zinc-950">{item.keyword}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{item.reason}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="access" className="bg-zinc-950 text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_360px] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Controlled access</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-semibold sm:text-4xl">
              Public homepage, protected product workflows.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-300">
              Students and operators keep using the authenticated dashboard. The landing page only explains the
              product and routes visitors into existing login, registration, and API documentation flows.
            </p>
          </div>
          <div className="rounded-lg border border-white/15 bg-white/5 p-5">
            <div className="flex items-center gap-3">
              <LockKeyhole className="h-5 w-5 text-emerald-300" aria-hidden="true" />
              <h3 className="font-semibold">No workflow changes</h3>
            </div>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
              <li>Login remains at /login.</li>
              <li>Dashboard remains at /dashboard.</li>
              <li>APIs and cron jobs are untouched.</li>
              <li>Shared cache behavior stays unchanged.</li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6 text-sm text-zinc-600 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <span>Discover Keywords</span>
          <div className="flex flex-wrap gap-4">
            <Link href="/login" className="hover:text-zinc-950">
              Login
            </Link>
            <Link href="/register" className="hover:text-zinc-950">
              Register
            </Link>
            <Link href="/api-docs" className="hover:text-zinc-950">
              API docs
            </Link>
            <Link href="/keyword-opportunity-platform" className="hover:text-zinc-950">
              Opportunity platform
            </Link>
            <Link href="/seo-signal-discovery" className="hover:text-zinc-950">
              Signal discovery
            </Link>
            <Link href="/programmatic-seo-keyword-research" className="hover:text-zinc-950">
              Programmatic SEO
            </Link>
            <Link href="/dashboard" className="hover:text-zinc-950">
              Dashboard
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ProductPreview() {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
        <div>
          <div className="text-sm font-semibold text-zinc-950">Opportunity queue</div>
          <div className="mt-1 text-xs text-zinc-500">Reviewed signals ready for action</div>
        </div>
        <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
          Live cache
        </span>
      </div>
      <div className="mt-4 grid gap-3">
        <PreviewRow
          icon={LineChart}
          title="Trend validated"
          detail="browser extension generator"
          value="+42%"
          tone="emerald"
        />
        <PreviewRow
          icon={BarChart3}
          title="SERP fit"
          detail="pricing calculator template"
          value="Tool"
          tone="sky"
        />
        <PreviewRow
          icon={Database}
          title="Shared cache"
          detail="student dashboard fallback"
          value="Ready"
          tone="amber"
        />
      </div>
      <div className="mt-5 rounded-lg border border-zinc-200 bg-[#f7f7f2] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-950">Signal review</div>
            <div className="mt-1 text-xs text-zinc-500">Noise blocked before expand</div>
          </div>
          <Layers3 className="h-5 w-5 text-zinc-500" aria-hidden="true" />
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-2 rounded-full bg-zinc-200">
            <div className="h-2 w-4/5 rounded-full bg-emerald-600" />
          </div>
          <div className="flex justify-between text-xs text-zinc-500">
            <span>Accepted opportunities</span>
            <span>80%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({
  icon: Icon,
  title,
  detail,
  value,
  tone,
}: {
  icon: typeof LineChart;
  title: string;
  detail: string;
  value: string;
  tone: "emerald" | "sky" | "amber";
}) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-800",
    sky: "bg-sky-50 text-sky-800",
    amber: "bg-amber-50 text-amber-800",
  }[tone];

  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-3">
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneClass}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-950">{title}</div>
        <div className="truncate text-xs text-zinc-500">{detail}</div>
      </div>
      <div className="text-sm font-semibold text-zinc-950">{value}</div>
    </div>
  );
}
