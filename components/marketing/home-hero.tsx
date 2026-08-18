import Link from "next/link";
import { ArrowRight, TrendingUp } from "lucide-react";
import { MarketingCtaLink } from "@/components/marketing-cta-link";
import { Reveal } from "@/components/marketing/reveal";
import { publicSignupCta } from "@/lib/public-signup";

export function HomeHero() {
  return (
    <section className="relative overflow-hidden bg-white">
      {/* Signature gradient mesh with an angled bottom edge — the page's one colorful moment */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[720px] [clip-path:polygon(0_0,100%_0,100%_86%,0_100%)] sm:h-[780px] lg:h-[840px]"
      >
        <div className="mk-mesh mk-mesh-drift absolute -inset-[12%]" />
      </div>

      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl pt-16 text-center sm:pt-20 lg:pt-24">
          <Reveal>
            <div className="inline-flex items-center gap-2.5 rounded-full border border-white/35 bg-white/15 px-4 py-1.5 text-xs font-medium text-white backdrop-blur sm:text-sm">
              <span className="relative flex h-2 w-2">
                <span className="mk-signal-ping absolute inline-flex h-full w-full rounded-full bg-white" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
              </span>
              Reviewed keyword intelligence for builders
            </div>
          </Reveal>

          <Reveal delay={90}>
            <h1 className="mt-8 text-balance text-5xl font-semibold leading-[1.04] tracking-[-0.03em] text-white [text-shadow:0_1px_24px_rgba(10,37,64,0.25)] sm:text-6xl xl:text-7xl">
              Find buildable keyword opportunities before the market sees them.
            </h1>
          </Reveal>

          <Reveal delay={180}>
            <p className="mx-auto mt-7 max-w-xl text-base leading-8 text-white/90 [text-shadow:0_1px_12px_rgba(10,37,64,0.2)] sm:text-lg">
              Discover Keywords watches product launches, communities, games, and niche feeds — then hands you a
              reviewed stream of keyword opportunities with the evidence to act.
            </p>
          </Reveal>

          <Reveal delay={270} className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <MarketingCtaLink
              href="/register"
              location="hero"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#0a2540] shadow-[0_8px_24px_-6px_rgba(10,37,64,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-6px_rgba(10,37,64,0.4)]"
            >
              {publicSignupCta()}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </MarketingCtaLink>
            <Link
              href="/pricing"
              className="group inline-flex h-12 items-center justify-center gap-1.5 text-sm font-semibold text-white transition hover:text-white/80"
            >
              View pricing
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </Reveal>
        </div>

        <RadarShowcase />
      </div>
    </section>
  );
}

function RadarShowcase() {
  return (
    <Reveal delay={220} className="relative z-10 mx-auto mt-14 w-full max-w-5xl pb-20 sm:mt-16 lg:pb-28 lg:[perspective:2000px]">
      <div className="relative rounded-2xl border border-[#e6ebf1] bg-white mk-shadow-lift transition-transform duration-700 ease-out lg:[transform:rotateX(4deg)] lg:hover:[transform:rotateX(0deg)]">
        <div className="flex items-center gap-3 border-b border-[#e6ebf1] bg-[#f6f9fc] px-5 py-3.5 rounded-t-2xl">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </div>
          <div className="flex-1 text-center font-mono text-xs tracking-wide text-[#6b7c93]">Opportunity Radar</div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            <span className="relative flex h-1.5 w-1.5">
              <span className="mk-signal-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        </div>

        <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[1.55fr_1fr]">
          <div className="rounded-xl border border-[#e6ebf1] bg-white p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b7c93]">
                  Top opportunity
                </div>
                <h3 className="mt-2 truncate font-mono text-lg font-semibold tracking-tight text-[#0a2540] sm:text-xl">
                  browser extension generator
                </h3>
              </div>
              <div className="w-fit flex-none rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-center">
                <div className="text-2xl font-semibold leading-none text-emerald-700">82</div>
                <div className="mt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-emerald-600">
                  Score
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <Metric label="Heat" value="82" />
              <Metric label="Recent ratio" value="1.8x" />
              <Metric label="Slope" value="+0.70" />
            </div>

            <div className="mt-5 rounded-xl border border-[#e6ebf1] bg-[#f6f9fc] p-4">
              <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b7c93]">
                <span>Trend signal</span>
                <span>90 days</span>
              </div>
              <svg className="mt-3 h-28 w-full" viewBox="0 0 360 110" role="img">
                <title>Rising keyword trend preview</title>
                <defs>
                  <linearGradient id="heroTrendLine" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#635bff" />
                    <stop offset="55%" stopColor="#0073e6" />
                    <stop offset="100%" stopColor="#00a3c4" />
                  </linearGradient>
                  <linearGradient id="heroTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#635bff" stopOpacity="0.16" />
                    <stop offset="100%" stopColor="#635bff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M0 88H360M0 56H360M0 24H360" stroke="#e6ebf1" strokeWidth="1" />
                <path
                  d="M8 92C55 91 82 91 116 86C151 81 168 70 190 48C220 17 255 16 287 25C314 33 337 41 352 37L352 104H8Z"
                  fill="url(#heroTrendFill)"
                />
                <path
                  d="M8 92C55 91 82 91 116 86C151 81 168 70 190 48C220 17 255 16 287 25C314 33 337 41 352 37"
                  fill="none"
                  stroke="url(#heroTrendLine)"
                  strokeLinecap="round"
                  strokeWidth="3"
                />
                <path d="M8 91H352" stroke="#10b981" strokeDasharray="5 6" strokeWidth="1.5" opacity="0.55" />
                <circle cx="352" cy="37" r="4" fill="#635bff" />
              </svg>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-xl border border-[#e6ebf1] bg-white p-5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b7c93]">
                Review states
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <State value="12" label="Pass" dot="bg-emerald-500" />
                <State value="8" label="Queue" dot="bg-[#00a3c4]" />
                <State value="6" label="Watch" dot="bg-[#635bff]" />
                <State value="31" label="Reject" dot="bg-rose-500" />
              </div>
            </div>
            <div className="rounded-xl border border-[#635bff]/20 bg-[#635bff]/[0.05] p-5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#635bff]">
                Why it passed
              </div>
              <p className="mt-3 text-sm leading-6 text-[#425466]">
                Tool-focused intent, rising demand, and a SERP with room for a focused utility page.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mk-float absolute -left-6 top-16 z-10 hidden w-56 rounded-xl border border-[#e6ebf1] bg-white px-4 py-3.5 mk-shadow-soft lg:block">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700">
          <span className="relative flex h-2 w-2">
            <span className="mk-signal-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Passed review
        </div>
        <div className="mt-2 truncate font-mono text-sm font-semibold text-[#0a2540]">ai headshot generator</div>
        <div className="mt-1 text-xs text-[#6b7c93]">Score 82 · Trend rising</div>
      </div>

      <div className="mk-float-delayed absolute -bottom-6 -right-4 z-10 hidden rounded-xl border border-[#e6ebf1] bg-white px-4 py-3.5 mk-shadow-soft lg:block">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#635bff]/20 bg-[#635bff]/[0.07] text-[#635bff]">
            <TrendingUp className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div>
            <div className="text-sm font-semibold text-[#0a2540]">+128 signals</div>
            <div className="text-xs text-[#6b7c93]">Collected this week</div>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#e6ebf1] bg-[#f6f9fc] px-3 py-3">
      <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#6b7c93]">{label}</div>
      <div className="mt-1.5 font-mono text-lg font-semibold text-[#0a2540]">{value}</div>
    </div>
  );
}

function State({ value, label, dot }: { value: string; label: string; dot: string }) {
  return (
    <div className="rounded-lg border border-[#e6ebf1] bg-[#f6f9fc] px-3 py-3">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
        <span className="font-mono text-lg font-semibold leading-none text-[#0a2540]">{value}</span>
      </div>
      <div className="mt-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#6b7c93]">
        {label}
      </div>
    </div>
  );
}
