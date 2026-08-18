import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCircle2, Plus, X, XCircle } from "lucide-react";
import { Reveal } from "@/components/marketing/reveal";
import { SectionHeading } from "@/components/marketing/section-heading";
import {
  heroStats,
  homeFaqs,
  productFeatures,
  solutionPages,
  workflowSteps,
  type HomeFeature,
  type HomeFeatureVisual,
} from "@/lib/marketing-home-content";
import { FOUNDING_MEMBER_PLAN } from "@/lib/pricing-copy";
import { publicSignupCta } from "@/lib/public-signup";

export function HomeAnnouncementBar() {
  return (
    <div className="relative border-b border-[#e6ebf1] bg-white">
      <Link
        href="/pricing"
        className="group mx-auto flex w-full max-w-7xl flex-wrap items-center justify-center gap-x-2.5 gap-y-1 px-4 py-2.5 text-center text-xs text-[#425466] transition hover:text-[#0a2540] sm:text-sm"
      >
        <span className="rounded-full border border-[#635bff]/25 bg-[#635bff]/[0.07] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#635bff]">
          New
        </span>
        <span>Founding Member access is open — $49/mo, tax included</span>
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

const signalSources = ["Product Hunt", "Reddit", "RSS feeds", "Steam", "Google Trends"];

export function HomeSourceStrip() {
  return (
    <section className="relative border-b border-[#e6ebf1] bg-[#f6f9fc]">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-center gap-x-9 gap-y-3 px-4 py-7 sm:px-6 lg:px-8">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6b7c93]">
          Monitoring signals from
        </span>
        {signalSources.map((source) => (
          <span
            key={source}
            className="flex items-center gap-2 font-mono text-sm text-[#425466] transition hover:text-[#0a2540]"
          >
            <span className="h-1 w-1 rounded-full bg-[#635bff]" aria-hidden="true" />
            {source}
          </span>
        ))}
      </div>
    </section>
  );
}

const oldWayItems = [
  "Exporting static keyword lists that are stale on arrival",
  "Looking up terms you already know exist",
  "Guessing which ideas have real demand",
  "Finding out the SERP is locked after you build",
];

const newWayItems = [
  "A reviewed stream of opportunities that comes to you",
  "Trend, intent, and SERP evidence attached to every keyword",
  "One buildability score for fast, confident decisions",
  "Weekly drops, before the market catches on",
];

export function HomeOldVsNew() {
  return (
    <section className="relative bg-white">
      <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
        <SectionHeading
          eyebrow="Why switch"
          title="Stop hunting keywords. Start receiving opportunities."
          description="Traditional tools wait for you to ask the right question. Discover Keywords watches the places where demand shows up first — and brings the answer to you."
        />
        <div className="mt-16 grid gap-5 lg:grid-cols-2">
          <Reveal className="h-full">
            <div className="h-full rounded-2xl border border-[#e6ebf1] bg-[#f6f9fc] p-7 sm:p-8">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6b7c93]">
                The old way
              </p>
              <ul className="mt-6 grid gap-4">
                {oldWayItems.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm leading-6 text-[#6b7c93]">
                    <X className="mt-1 h-4 w-4 flex-none text-rose-400" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
          <Reveal delay={120} className="h-full">
            <div className="h-full rounded-2xl bg-[#0a2540] p-7 shadow-[0_16px_48px_-12px_rgba(10,37,64,0.35)] sm:p-8">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-300">
                The new way
              </p>
              <ul className="mt-6 grid gap-4">
                {newWayItems.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm leading-6 text-white/90">
                    <CheckCircle2 className="mt-1 h-4 w-4 flex-none text-emerald-400" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function HomeWorkflow() {
  return (
    <section id="workflow" className="relative border-t border-[#e6ebf1] bg-[#f6f9fc]">
      <div className="relative mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
        <SectionHeading
          eyebrow="Workflow"
          title="From raw signal to build decision."
          description="Every opportunity you see has already survived the pipeline below — so your research time goes to ideas that were worth reviewing in the first place."
        />
        <div className="relative mt-16">
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-6 hidden h-px bg-[#e6ebf1] lg:block"
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {workflowSteps.map((step, index) => (
              <Reveal key={step.title} delay={index * 100} className="h-full">
                <div className="group relative h-full rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)]">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-[#635bff]/20 bg-[#635bff]/[0.07] font-mono text-sm font-semibold text-[#635bff]">
                    {step.label}
                  </div>
                  <h3 className="mt-6 text-lg font-semibold tracking-tight text-[#0a2540]">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#425466]">{step.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const featureAccents = ["#635bff", "#0073e6", "#00a3c4", "#a960ee", "#ff5996", "#ff8a00"];

export function HomeBento() {
  return (
    <section id="product" className="relative bg-white">
      <div className="relative mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
        <SectionHeading
          eyebrow="Product"
          title="A clearer research system, not another keyword export."
          description="Discover Keywords watches the places where demand shows up first, then turns that noise into a reviewed queue of opportunities you can actually build for."
        />
        <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {productFeatures.map((feature, index) => (
            <BentoCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}

function BentoCard({ feature, index }: { feature: HomeFeature; index: number }) {
  const accent = featureAccents[index % featureAccents.length];
  return (
    <Reveal
      delay={(index % 3) * 90}
      className={`h-full ${feature.span === "wide" ? "md:col-span-2" : ""}`}
    >
      <div className="group flex h-full flex-col rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)] sm:p-7">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-md"
          style={{ backgroundColor: accent, boxShadow: `0 8px 20px -6px ${accent}55` }}
        >
          <feature.icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <h3 className="mt-6 text-lg font-semibold tracking-tight text-[#0a2540]">{feature.title}</h3>
        <p className="mt-3 text-sm leading-6 text-[#425466]">{feature.text}</p>
        <div className="mt-auto pt-7">
          <FeatureFlourish visual={feature.visual} />
        </div>
      </div>
    </Reveal>
  );
}

function FeatureFlourish({ visual }: { visual: HomeFeatureVisual }) {
  switch (visual) {
    case "chips":
      return (
        <div className="flex flex-wrap gap-2">
          {["ai headshot generator", "podcast name generator", "mayan astrology calculator"].map((keyword) => (
            <span
              key={keyword}
              className="rounded-md border border-[#e6ebf1] bg-[#f6f9fc] px-2.5 py-1 font-mono text-xs text-[#425466]"
            >
              {keyword}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-xs text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            +128 this week
          </span>
        </div>
      );
    case "review":
      return (
        <div className="grid gap-2">
          <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <CheckCircle2 className="h-4 w-4 flex-none text-emerald-600" aria-hidden="true" />
            <span className="font-mono text-xs text-[#425466]">Tool intent, rising trend — passed</span>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
            <XCircle className="h-4 w-4 flex-none text-rose-500" aria-hidden="true" />
            <span className="font-mono text-xs text-[#6b7c93]">Celebrity news spike — rejected</span>
          </div>
        </div>
      );
    case "score":
      return (
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 flex-none flex-col items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50">
            <span className="text-xl font-semibold leading-none text-emerald-700">82</span>
            <span className="mt-1 font-mono text-[8px] font-semibold uppercase tracking-[0.2em] text-emerald-600">
              Score
            </span>
          </div>
          <div className="grid flex-1 gap-2.5">
            {[
              { label: "Trend", width: "82%" },
              { label: "Intent", width: "64%" },
              { label: "SERP fit", width: "91%" },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="w-14 flex-none font-mono text-[10px] font-semibold uppercase tracking-wider text-[#6b7c93]">
                  {row.label}
                </span>
                <div className="h-1.5 flex-1 rounded-full bg-[#e6ebf1]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#635bff] to-[#00a3c4]"
                    style={{ width: row.width }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case "brief":
      return (
        <div className="rounded-lg border border-[#e6ebf1] bg-[#f6f9fc] p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#635bff]">
              Build Brief
            </span>
            <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-700">
              Ready
            </span>
          </div>
          <div className="mt-3.5 h-2.5 w-3/4 rounded-full bg-[#d7dee8]" />
          <div className="mt-3 grid gap-2">
            <div className="h-1.5 w-full rounded-full bg-[#e6ebf1]" />
            <div className="h-1.5 w-5/6 rounded-full bg-[#e6ebf1]" />
            <div className="h-1.5 w-2/3 rounded-full bg-[#e6ebf1]" />
          </div>
        </div>
      );
    case "api":
      return (
        <div className="rounded-lg bg-[#0a2540] p-4 font-mono text-xs leading-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="text-white/60">
            <span className="font-semibold text-cyan-300">GET</span> /v1/opportunities?min_score=75
          </div>
          <div className="mt-1.5 text-emerald-300">→ 200 OK · 12 reviewed opportunities</div>
        </div>
      );
    case "billing":
      return (
        <div>
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="mk-text-gradient font-mono text-4xl font-semibold tracking-tight">$49</span>
            <span className="pb-1 font-mono text-xs text-[#6b7c93]">/ month, tax included</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-[#425466]">
            <span>No meters</span>
            <span className="text-[#a3b3c6]">·</span>
            <span>No credit math</span>
            <span className="text-[#a3b3c6]">·</span>
            <span>No surprises</span>
          </div>
        </div>
      );
  }
}

export function HomeStatsBand() {
  return (
    <section className="relative overflow-hidden border-y border-[#e6ebf1] bg-[#f6f9fc]">
      <div className="relative mx-auto grid w-full max-w-7xl grid-cols-2 gap-y-12 px-4 py-16 sm:px-6 lg:grid-cols-4 lg:px-8 lg:py-20">
        {heroStats.map((stat, index) => (
          <Reveal key={stat.label} delay={index * 80} className="text-center">
            <div className="mk-text-gradient text-5xl font-semibold tracking-tight sm:text-6xl">{stat.value}</div>
            <div className="mt-3 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b7c93]">
              {stat.label}
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const pricingHighlights = [
  "Full Opportunity Radar access",
  "Private opportunity database",
  "20 Build Brief credits per month",
  "Trend, SERP, and evidence views",
];

export function HomePricingPreview() {
  return (
    <section className="relative overflow-hidden bg-white">
      <div aria-hidden="true" className="absolute inset-0">
        <div className="mk-grid-light mk-fade-top absolute inset-0 opacity-70" />
      </div>
      <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_440px] lg:items-center lg:px-8 lg:py-32">
        <SectionHeading
          eyebrow="Pricing"
          title="Founding access for builders who act."
          description="The first paid plan is intentionally focused: full Opportunity Radar access, the private opportunity database, and Build Brief credits for people who can turn one good keyword into a product, page, or campaign."
        />
        <Reveal delay={120}>
          <div className="rounded-3xl bg-[#0a2540] p-7 shadow-[0_24px_64px_-16px_rgba(10,37,64,0.4)] sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
                  {FOUNDING_MEMBER_PLAN.name}
                </div>
                <div className="mt-4 flex items-end gap-2">
                  <span className="text-5xl font-semibold tracking-tight text-white">
                    {FOUNDING_MEMBER_PLAN.price}
                  </span>
                  <span className="pb-1.5 text-sm text-white/60">/ month</span>
                </div>
                <div className="mt-1.5 text-xs text-white/50">Tax included. Cancel anytime.</div>
              </div>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-white/80">
                Founding
              </span>
            </div>
            <ul className="mt-7 grid gap-3 border-t border-white/10 pt-6 text-sm leading-6 text-white/85">
              {pricingHighlights.map((item) => (
                <li key={item} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-400" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/pricing"
              className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-[#0a2540] transition hover:bg-[#f6f9fc]"
            >
              View pricing
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function HomeSolutions() {
  return (
    <section id="solutions" className="relative border-t border-[#e6ebf1] bg-[#f6f9fc]">
      <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <SectionHeading eyebrow="Solutions" title="A clear path for every search intent." />
          <Link
            href="/api-docs"
            className="group inline-flex flex-none items-center gap-2 text-sm font-semibold text-[#635bff] transition hover:text-[#0073e6]"
          >
            API docs
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {solutionPages.map((page, index) => (
            <Reveal key={page.href} delay={(index % 3) * 80} className="h-full">
              <Link
                href={page.href}
                className="group flex h-full flex-col rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-lg font-semibold tracking-tight text-[#0a2540]">{page.title}</h3>
                  <ArrowUpRight
                    className="mt-1 h-5 w-5 flex-none text-[#a3b3c6] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#635bff]"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-4 text-sm leading-6 text-[#425466]">{page.text}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomeFaq() {
  return (
    <section id="faq" className="relative border-t border-[#e6ebf1] bg-white">
      <div className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[380px_1fr] lg:px-8 lg:py-32">
        <div>
          <SectionHeading
            eyebrow="FAQ"
            title="Questions builders ask before subscribing."
            description="Everything else you want to know lives in the product docs and the pricing page."
          />
          <Link
            href="/api-docs"
            className="group mt-8 inline-flex items-center gap-2 text-sm font-semibold text-[#635bff] transition hover:text-[#0073e6]"
          >
            Read the docs
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
        <Reveal>
          <div className="divide-y divide-[#e6ebf1] rounded-2xl border border-[#e6ebf1] bg-white px-6">
            {homeFaqs.map((item) => (
              <details key={item.question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-semibold text-[#0a2540] transition hover:text-[#635bff] [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <Plus
                    className="h-4 w-4 flex-none text-[#a3b3c6] transition duration-300 group-open:rotate-45 group-open:text-[#635bff]"
                    aria-hidden="true"
                  />
                </summary>
                <p className="mt-3 pr-8 text-sm leading-7 text-[#425466]">{item.answer}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function HomeCta() {
  return (
    <section className="relative overflow-hidden">
      {/* Gradient mesh bookend — mirrors the hero's angled edge */}
      <div
        aria-hidden="true"
        className="absolute inset-0 [clip-path:polygon(0_14%,100%_0,100%_100%,0_100%)]"
      >
        <div className="mk-mesh mk-mesh-drift absolute -inset-[12%]" />
      </div>
      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-36 text-center sm:px-6 sm:py-44 lg:px-8 lg:py-52">
        <Reveal>
          <h2 className="text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.03em] text-white [text-shadow:0_1px_24px_rgba(10,37,64,0.25)] sm:text-6xl">
            The next opportunity is already moving.
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p className="mt-7 max-w-2xl text-base leading-8 text-white/90 [text-shadow:0_1px_12px_rgba(10,37,64,0.2)] sm:text-lg">
            Join the builders who review fresh, evidence-backed keyword opportunities every week — and ship what
            demand already wants.
          </p>
        </Reveal>
        <Reveal delay={200} className="mt-12 flex flex-col gap-4 sm:flex-row">
          <Link
            href="/register"
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#0a2540] shadow-[0_8px_24px_-6px_rgba(10,37,64,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-6px_rgba(10,37,64,0.4)]"
          >
            {publicSignupCta()}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          <Link
            href="/pricing"
            className="group inline-flex h-12 items-center justify-center gap-1.5 text-sm font-semibold text-white transition hover:text-white/80"
          >
            View pricing
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </Reveal>
        <Reveal delay={280}>
          <p className="mt-8 font-mono text-xs text-white/75">$49/mo, tax included · Cancel anytime</p>
        </Reveal>
      </div>
    </section>
  );
}
