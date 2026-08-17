import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  DatabaseZap,
  Gauge,
  Layers3,
  LockKeyhole,
  Radar,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import { FaqSchema } from "@/components/faq-schema";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { FOUNDING_MEMBER_PLAN } from "@/lib/pricing-copy";
import { publicSignupCta } from "@/lib/public-signup";

export const dynamic = "force-static";

const productFeatures = [
  {
    title: "Signal discovery",
    text: "Capture fresh product, community, game, RSS, and operator signals before they become crowded keywords.",
    icon: Radar,
  },
  {
    title: "Human-safe review",
    text: "Filter noisy spikes, trademark risk, celebrity trends, and short-lived news before research starts.",
    icon: ShieldCheck,
  },
  {
    title: "SERP-aware scoring",
    text: "Blend trend movement, intent, SERP shape, CPC, and difficulty into a practical buildability score.",
    icon: SearchCheck,
  },
  {
    title: "Subscription guardrails",
    text: "Keep public pages fast and static while paid users unlock authenticated product workflows.",
    icon: DatabaseZap,
  },
];

const workflow = [
  {
    label: "01",
    title: "Collect",
    text: "New signals enter a shared queue from product, community, and game sources.",
  },
  {
    label: "02",
    title: "Review",
    text: "Each signal is screened for noise, intent quality, and buildable search demand.",
  },
  {
    label: "03",
    title: "Validate",
    text: "Trends, SERP shape, and evidence are checked before an opportunity is promoted.",
  },
  {
    label: "04",
    title: "Act",
    text: "Approved ideas become briefs, watchlists, game opportunities, and page clusters.",
  },
];

const useCases = [
  {
    title: "Tool-site operators",
    text: "Find generator, calculator, template, and workflow keywords before they feel crowded.",
    href: "/keyword-opportunity-platform",
    icon: Zap,
  },
  {
    title: "SEO teams",
    text: "Turn noisy multi-source demand into reviewed keyword candidates with clear evidence.",
    href: "/seo-signal-discovery",
    icon: Layers3,
  },
  {
    title: "Programmatic SEO",
    text: "Prioritize repeatable page patterns from demand shape instead of static exports.",
    href: "/programmatic-seo-keyword-research",
    icon: Workflow,
  },
  {
    title: "Game keyword research",
    text: "Screen game opportunities with relevance, trend checks, and SERP-fit review.",
    href: "/game-keyword-research",
    icon: BarChart3,
  },
];

const solutionPages = [
  {
    title: "Opportunity platform",
    href: "/keyword-opportunity-platform",
    text: "Reviewed signals become buildable keyword opportunities.",
  },
  {
    title: "Signal discovery",
    href: "/seo-signal-discovery",
    text: "Collection, filtering, review, and validation in one workflow.",
  },
  {
    title: "Programmatic SEO",
    href: "/programmatic-seo-keyword-research",
    text: "Repeatable page patterns for tools, templates, games, and clusters.",
  },
  {
    title: "Game keywords",
    href: "/game-keyword-research",
    text: "Safer game opportunities with relevance and SERP validation.",
  },
  {
    title: "AI keywords",
    href: "/ai-keyword-research",
    text: "AI product, agent, and workflow signals filtered before research.",
  },
  {
    title: "API docs",
    href: "/api-docs",
    text: "Guarded access and shared-cache behavior for developers.",
  },
];

const stats = [
  { label: "Signal layers", value: "5+" },
  { label: "Review gates", value: "3" },
  { label: "Paid calls guarded", value: "100%" },
  { label: "Public pages", value: "Static" },
];

const guardrails = [
  "Login remains at /login.",
  "Dashboard remains at /dashboard.",
  "Public pages stay static.",
  "Shared cache behavior stays unchanged.",
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
  {
    question: "How is this different from a normal keyword tool?",
    answer:
      "Traditional keyword tools mostly help you look up known terms. Discover Keywords focuses on reviewed signals that can reveal opportunities before they become crowded.",
  },
  {
    question: "What data sources does the public site expose?",
    answer:
      "The public site only shows static examples and product positioning. Raw sources, review queues, API keys, and research history stay inside authenticated workflows.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#fbfcff] text-slate-950">
      <FaqSchema faqs={faqs} />
      <MarketingHeader />

      <section className="border-b border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f3f8ff_100%)]">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-4 pb-14 pt-12 sm:px-6 sm:pb-18 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:pb-20 lg:pt-16">
          <div className="flex min-w-0 flex-col justify-center">
            <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-800 shadow-sm sm:text-sm">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Reviewed keyword intelligence for SaaS builders
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.04] tracking-normal text-slate-950 sm:text-6xl">
              Find buildable keyword opportunities before the market sees them.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-xl">
              Discover Keywords turns noisy market signals into reviewed, trend-checked, and SERP-aware opportunities
              for tool sites, AI products, game sites, and SEO operators.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-slate-950 px-6 text-sm font-semibold text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                {publicSignupCta()}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex h-12 items-center justify-center rounded-md border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-400"
              >
                View pricing
              </Link>
            </div>
            <div className="mt-8 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.map((item) => (
                <div key={item.label} className="rounded-lg border border-slate-200 bg-white/80 p-3 shadow-sm">
                  <div className="text-xl font-semibold text-slate-950">{item.value}</div>
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <MarketingProductShowcase />
        </div>
      </section>

      <section id="product" className="bg-white">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Product</p>
            <h2 className="mt-3 text-3xl font-semibold text-slate-950 sm:text-5xl">
              A clearer research system, not another keyword export.
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-600">
              The homepage now behaves like a product website: it explains what the SaaS does, who it is for, why the
              workflow is safer, and where paid access begins.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard/opportunities"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Open product
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/api-docs"
                className="inline-flex h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-900 hover:border-slate-400"
              >
                Read docs
              </Link>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {productFeatures.map((feature) => (
              <div key={feature.title} className="rounded-lg border border-slate-200 bg-slate-50 p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-blue-700 shadow-sm">
                  <feature.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-slate-950">{feature.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{feature.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Workflow</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950 sm:text-5xl">
                From raw signal to build decision.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-slate-600 lg:justify-self-end">
              The public homepage is marketing only. The real work stays inside authenticated review queues,
              dashboards, shared caches, and guarded API routes.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflow.map((step) => (
              <div key={step.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm font-semibold text-emerald-700">{step.label}</div>
                <h3 className="mt-5 text-lg font-semibold text-slate-950">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="use-cases" className="bg-white">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.72fr_1.28fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Who it is for</p>
            <h2 className="mt-3 text-3xl font-semibold text-slate-950 sm:text-5xl">
              Built for teams that choose what to build next.
            </h2>
            <p className="mt-5 text-base leading-7 text-slate-600">
              Each route maps to a real SaaS workflow: discover, review, validate, subscribe, and decide what is worth
              building next.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {useCases.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-slate-950 text-white">
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-slate-950">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.text}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
                  Explore
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing-preview" className="border-y border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_420px] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">Pricing</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-semibold sm:text-5xl">
              Founding access for builders who use keyword opportunities to decide what to build.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              The first paid plan is intentionally focused: full Opportunity Radar access, private opportunity data,
              and Build Brief credits for people who can turn one good keyword into a product, page, or campaign.
            </p>
          </div>
          <div className="rounded-lg border border-white/15 bg-white/[0.06] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-emerald-200">{FOUNDING_MEMBER_PLAN.name}</div>
                <div className="mt-3 text-4xl font-semibold">{FOUNDING_MEMBER_PLAN.price}</div>
                <div className="mt-1 text-sm text-slate-400">{FOUNDING_MEMBER_PLAN.interval}</div>
              </div>
              <DatabaseZap className="h-6 w-6 text-emerald-300" aria-hidden="true" />
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-300">{FOUNDING_MEMBER_PLAN.summary}</p>
            <ul className="mt-6 grid gap-3 text-sm leading-6 text-slate-300">
              <li className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-300" aria-hidden="true" />
                Full opportunity radar access
              </li>
              <li className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-300" aria-hidden="true" />
                20 Build Brief credits per month
              </li>
              <li className="flex gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-300" aria-hidden="true" />
                Trend, SERP, and evidence views
              </li>
            </ul>
            <Link
              href="/pricing"
              className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-white px-5 text-sm font-semibold text-slate-950 hover:bg-slate-100"
            >
              View pricing
            </Link>
          </div>
        </div>
      </section>

      <section id="solutions" className="bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Solutions</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-950 sm:text-5xl">
                Clear public paths for every search intent.
              </h2>
            </div>
            <Link href="/api-docs" className="text-sm font-semibold text-slate-900 hover:text-emerald-700">
              API docs
            </Link>
          </div>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {solutionPages.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className="group rounded-lg border border-slate-200 bg-slate-50 p-5 transition hover:-translate-y-0.5 hover:border-amber-300 hover:bg-white hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-xl font-semibold text-slate-950">{page.title}</h3>
                  <ArrowRight className="mt-1 h-5 w-5 flex-none text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-amber-700" aria-hidden="true" />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">{page.text}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[360px_1fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">FAQ</p>
            <h2 className="mt-3 text-3xl font-semibold text-slate-950">How the public site stays safe.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {faqs.map((item) => (
              <div key={item.question} className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="font-semibold text-slate-950">{item.question}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="access" className="bg-slate-950 text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
          <div>
            <div className="mb-5 flex w-fit items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-sm font-semibold text-emerald-200">
              <Gauge className="h-4 w-4" aria-hidden="true" />
              Controlled access
            </div>
            <h2 className="max-w-3xl text-3xl font-semibold sm:text-5xl">
              Public homepage, protected product workflows.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              Students and operators keep using the authenticated dashboard. The website routes visitors into existing
              login, registration, pricing, and API documentation flows.
            </p>
          </div>
          <div className="rounded-lg border border-white/15 bg-white/[0.06] p-5">
            <div className="flex items-center gap-3">
              <LockKeyhole className="h-5 w-5 text-emerald-300" aria-hidden="true" />
              <h3 className="font-semibold">No workflow changes</h3>
            </div>
            <ul className="mt-5 grid gap-3 text-sm leading-6 text-slate-300">
              {guardrails.map((item) => (
                <li key={item} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-300" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}

function MarketingProductShowcase() {
  return (
    <div className="relative min-w-0">
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-950/10">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-950">Opportunity Radar</div>
              <div className="mt-1 text-xs text-slate-500">Reviewed keyword intelligence workspace</div>
            </div>
            <div className="flex gap-2 text-xs font-semibold">
              <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">Live cache</span>
              <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-800">SERP-ready</span>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px]">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top opportunity</div>
                  <h3 className="mt-2 text-2xl font-semibold text-slate-950">browser extension generator</h3>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center">
                  <div className="text-2xl font-semibold text-emerald-800">82</div>
                  <div className="text-[11px] font-semibold uppercase text-emerald-700">Score</div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <Metric label="Heat" value="82" />
                <Metric label="Recent ratio" value="1.8x" />
                <Metric label="Slope" value="+0.70" />
              </div>

              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <span>Trend signal</span>
                  <span>90 days</span>
                </div>
                <div className="mt-5 h-28 overflow-hidden rounded-md bg-white p-3">
                  <svg className="h-full w-full" viewBox="0 0 360 110" role="img">
                    <title>Rising keyword trend preview</title>
                    <path d="M0 88H360M0 56H360M0 24H360" stroke="#e2e8f0" strokeWidth="1" />
                    <path
                      d="M8 92C55 91 82 91 116 86C151 81 168 70 190 48C220 17 255 16 287 25C314 33 337 41 352 37"
                      fill="none"
                      stroke="#2563eb"
                      strokeLinecap="round"
                      strokeWidth="4"
                    />
                    <path
                      d="M8 92C55 91 82 91 116 86C151 81 168 70 190 48C220 17 255 16 287 25C314 33 337 41 352 37L352 104H8Z"
                      fill="#dbeafe"
                    />
                    <path d="M8 91H352" stroke="#84cc16" strokeDasharray="6 6" strokeWidth="2" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Review states</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <State value="12" label="Pass" tone="emerald" />
                  <State value="8" label="Queue" tone="sky" />
                  <State value="6" label="Watch" tone="blue" />
                  <State value="31" label="Reject" tone="rose" />
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-950 p-4 text-white">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Why it passed</div>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Tool-focused intent, rising demand, and a SERP with room for a focused utility page.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function State({ value, label, tone }: { value: string; label: string; tone: "emerald" | "sky" | "blue" | "rose" }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-800",
    sky: "bg-sky-50 text-sky-800",
    blue: "bg-blue-50 text-blue-800",
    rose: "bg-rose-50 text-rose-800",
  };

  return (
    <div className={`rounded-lg px-3 py-3 text-center ${tones[tone]}`}>
      <div className="text-xl font-semibold leading-none">{value}</div>
      <div className="mt-1 truncate text-[11px] font-semibold">{label}</div>
    </div>
  );
}
