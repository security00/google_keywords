import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Gauge,
  LockKeyhole,
  Radar,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { ProductEvidencePreview } from "@/components/product-evidence-preview";

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
    text: "Find new game keyword opportunities with review gates and SERP-fit checks.",
    href: "/game-keyword-research",
  },
  {
    text: "Discover AI product and workflow keywords before crowded tools expose them.",
    href: "/ai-keyword-research",
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
  {
    title: "Game keyword research",
    href: "/game-keyword-research",
    text: "How reviewed game signals become safer keyword opportunities with game relevance and SERP validation.",
  },
  {
    title: "AI keyword research",
    href: "/ai-keyword-research",
    text: "How AI product, agent, and workflow signals are filtered before they become keyword research candidates.",
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

const faqs = [
  {
    question: "How do people get access?",
    answer:
      "Access still goes through the existing registration, login, and invite-based student activation flow. The public site only explains the product.",
  },
  {
    question: "Do public pages trigger paid research calls?",
    answer:
      "No. The homepage, API docs, and SEO pages are static marketing pages and do not call DataForSEO, OpenRouter, SERP, D1, or protected dashboard APIs.",
  },
  {
    question: "What protects student workflows?",
    answer:
      "Student-facing research stays on shared cache and guarded endpoints. If a fresh cache is not ready, the product falls back to the latest successful shared cache.",
  },
  {
    question: "Where does keyword discovery happen?",
    answer:
      "Collection, filtering, trend checks, SERP validation, and review workflows stay inside protected dashboard and background systems.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f7f7f2] text-zinc-950">
      <MarketingHeader />

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
              <span className="text-zinc-300">/</span>
              <Link href="/game-keyword-research" className="hover:text-emerald-700">
                Game keyword research
              </Link>
              <span className="text-zinc-300">/</span>
              <Link href="/ai-keyword-research" className="hover:text-emerald-700">
                AI keyword research
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

          <ProductEvidencePreview />
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

      <section className="border-t border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[360px_1fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">FAQ</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950">How the public site stays safe.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {faqs.map((item) => (
              <div key={item.question} className="rounded-lg border border-zinc-200 bg-white p-5">
                <h3 className="font-semibold text-zinc-950">{item.question}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{item.answer}</p>
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

      <MarketingFooter />
    </main>
  );
}
