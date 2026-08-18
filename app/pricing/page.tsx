import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  GraduationCap,
  Radar,
  ShieldCheck,
} from "lucide-react";

import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { Reveal } from "@/components/marketing/reveal";
import { SectionHeading } from "@/components/marketing/section-heading";
import { PricingAutoCheckout, PricingCheckoutButton } from "@/components/pricing-cta";
import { marketingPageMetadata } from "@/lib/marketing-metadata";
import { FOUNDING_MEMBER_PLAN } from "@/lib/pricing-copy";

export const dynamic = "force-static";

export const metadata: Metadata = {
  ...marketingPageMetadata({
    title: "Pricing | Discover Keywords",
    description:
      "Start with the Discover Keywords Founding Member plan. Unlock the full opportunity radar, buildable keyword scores, and build brief credits.",
    path: "/pricing",
  }),
};

const included = [
  "Full Opportunity Radar across new keywords, games, and validated markets",
  "Buildable keyword scores with Build / Watch / Skip decisions",
  "20 Build Brief credits per month for MVP direction and SEO structure",
  "The full private opportunity database — far beyond the public samples",
  "A seamless way for course and student members to continue after trial",
  "Self-serve billing portal to manage or cancel your plan anytime",
];

const limits = [
  { label: "Opportunity database", value: "Full access" },
  { label: "Build Briefs", value: "20 / month" },
  { label: "Fresh opportunities", value: "Reviewed weekly" },
  { label: "Best for", value: "Indie hackers and solo builders" },
];

const memberHighlights = [
  {
    title: "Opportunity Radar",
    text: "Browse reviewed, buildable keyword opportunities across every signal source we track.",
    icon: Radar,
    accent: "#635bff",
  },
  {
    title: "Buildability score",
    text: "Use status, score, risk, and evidence to decide whether to build, watch, or skip.",
    icon: ShieldCheck,
    accent: "#0073e6",
  },
  {
    title: "Build Brief credits",
    text: "Turn selected opportunities into MVP scope, SEO page structure, and next steps.",
    icon: FileText,
    accent: "#00a3c4",
  },
  {
    title: "Private database",
    text: "Membership unlocks the working opportunity pool that public pages only sample.",
    icon: Database,
    accent: "#a960ee",
  },
];

const roadmapPlans = [
  {
    name: "Scout",
    note: "Lower-cost discovery plan for lighter usage.",
  },
  {
    name: "Builder",
    note: "More briefs, export flows, and deeper validation.",
  },
  {
    name: "Studio",
    note: "Team workflows, higher limits, and advanced operations.",
  },
];

const primaryCtaClass =
  "group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#0a2540] px-7 text-sm font-semibold text-white shadow-[0_8px_24px_-6px_rgba(10,37,64,0.35)] transition hover:-translate-y-0.5 hover:bg-[#12315a] disabled:opacity-60";

const secondaryCtaClass =
  "inline-flex h-12 items-center justify-center rounded-full border border-[#d7dee8] bg-white px-7 text-sm font-semibold text-[#0a2540] transition hover:-translate-y-0.5 hover:border-[#a3b3c6]";

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-white text-[#425466]">
      <Suspense fallback={null}>
        <PricingAutoCheckout />
      </Suspense>
      <MarketingHeader />

      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 [clip-path:polygon(0_0,100%_0,100%_calc(100%_-_72px),0_100%)]">
          <div className="mk-mesh mk-mesh-drift absolute -inset-[12%]" />
        </div>

        <div className="relative mx-auto grid w-full max-w-7xl gap-14 px-4 pb-24 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1fr_460px] lg:items-center lg:px-8 lg:pb-28">
          <div>
            <Reveal>
              <div className="inline-flex items-center gap-2.5 rounded-full border border-white/35 bg-white/15 px-4 py-1.5 text-xs font-medium text-white backdrop-blur sm:text-sm">
                <span className="relative flex h-2 w-2">
                  <span className="mk-signal-ping absolute inline-flex h-full w-full rounded-full bg-white" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
                Founding Member access is open
              </div>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="mt-7 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-white [text-shadow:0_1px_24px_rgba(10,37,64,0.25)] sm:text-5xl lg:text-6xl">
                Founding access for builders who act on keyword opportunities.
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 max-w-xl text-base leading-8 text-white/90 [text-shadow:0_1px_12px_rgba(10,37,64,0.2)] sm:text-lg">
                The Founding Member plan is intentionally focused: full Opportunity Radar access, the private
                opportunity database, and Build Brief credits for people who can turn one strong opportunity into a
                product, page, or campaign.
              </p>
            </Reveal>
            <Reveal delay={240} className="mt-9 flex flex-col gap-3 sm:flex-row">
              <PricingCheckoutButton className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#0a2540] shadow-[0_8px_24px_-6px_rgba(10,37,64,0.35)] transition hover:-translate-y-0.5 disabled:opacity-60" />
              <Link
                href="/keyword-opportunity-platform"
                className="inline-flex h-12 items-center justify-center rounded-full border border-white/40 bg-white/10 px-7 text-sm font-semibold text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/20"
              >
                See how it works
              </Link>
            </Reveal>
            <Reveal delay={320}>
              <p className="mt-6 font-mono text-xs text-white/80">
                $49/mo, tax included · Cancel anytime · 20 Build Brief credits monthly
              </p>
            </Reveal>
          </div>

          <Reveal delay={160} className="relative">
            <div className="relative rounded-3xl bg-[#0a2540] p-7 shadow-[0_32px_80px_-20px_rgba(10,37,64,0.5)] sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
                    {FOUNDING_MEMBER_PLAN.name}
                  </div>
                  <div className="mt-4 flex items-end gap-2">
                    <span className="text-6xl font-semibold tracking-tight text-white">
                      {FOUNDING_MEMBER_PLAN.price}
                    </span>
                    <span className="pb-2 text-sm text-white/60">/ month</span>
                  </div>
                  <div className="mt-1.5 text-xs text-white/50">Tax included. Cancel anytime.</div>
                </div>
                <span className="flex-none rounded-full border border-white/15 bg-white/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-white/80">
                  Founding
                </span>
              </div>

              <p className="mt-6 text-sm leading-6 text-white/70">{FOUNDING_MEMBER_PLAN.summary}</p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                {limits.map((item) => (
                  <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-3">
                    <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-white/50">
                      {item.label}
                    </div>
                    <div className="mt-1.5 text-sm font-semibold text-white">{item.value}</div>
                  </div>
                ))}
              </div>

              <ul className="mt-7 grid gap-3 border-t border-white/10 pt-6 text-sm leading-6 text-white/85">
                {included.map((item) => (
                  <li key={item} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-400" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <PricingCheckoutButton
                  label={FOUNDING_MEMBER_PLAN.checkoutLabel}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-semibold text-[#0a2540] transition hover:bg-[#f6f9fc] disabled:opacity-60"
                />
              </div>
              <p className="mt-4 text-center font-mono text-[11px] text-white/50">
                Secure checkout by Stripe · Tax included
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-white">
        <div className="relative mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <SectionHeading
            eyebrow="What you get"
            title="Priced for decision value, not raw keyword volume."
            description="$49/month, tax included, is the early Founding Member price for reviewed opportunities, evidence, and brief credits. Lower-cost and higher-limit tiers can follow once founding members prove usage patterns."
          />
          <div className="mt-14 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {memberHighlights.map((item, index) => (
              <Reveal key={item.title} delay={(index % 4) * 90} className="h-full">
                <div className="h-full rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)]">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-white shadow-md"
                    style={{ backgroundColor: item.accent, boxShadow: `0 8px 20px -6px ${item.accent}55` }}
                  >
                    <item.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-6 text-lg font-semibold tracking-tight text-[#0a2540]">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#425466]">{item.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-[#f6f9fc]">
        <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8 lg:py-32">
          <SectionHeading
            eyebrow="Trials and students"
            title="Already learning with us? Your progress carries over."
            description="Student and course members keep full product access during their granted trial window. When the window ends, subscribing keeps the complete Opportunity Radar and your research history in place."
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Reveal className="h-full">
              <div className="h-full rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)]">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#ff8a00] text-white shadow-md shadow-[#ff8a00]/30">
                  <Clock className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mt-6 text-lg font-semibold tracking-tight text-[#0a2540]">90-day course trial</h3>
                <p className="mt-3 text-sm leading-6 text-[#425466]">
                  Course members receive a generous trial window with full access — plenty of time to ship real
                  research before deciding.
                </p>
              </div>
            </Reveal>
            <Reveal delay={120} className="h-full">
              <div className="h-full rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)]">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#ff5996] text-white shadow-md shadow-[#ff5996]/30">
                  <GraduationCap className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mt-6 text-lg font-semibold tracking-tight text-[#0a2540]">After your trial</h3>
                <p className="mt-3 text-sm leading-6 text-[#425466]">
                  Keep exploring public sample opportunities for free, and subscribe whenever you want the full
                  database back.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <SectionHeading
              eyebrow="Coming later"
              title="More tiers will follow the founding beta."
              description="Scout, Builder, and Studio are on the roadmap. Founding Members lock in the simplest deal we will ever offer."
            />
            <Reveal delay={120}>
              <PricingCheckoutButton
                label="Get founding access"
                className="inline-flex h-11 flex-none items-center justify-center gap-2 rounded-full border border-[#d7dee8] bg-white px-6 text-sm font-semibold text-[#0a2540] transition hover:border-[#a3b3c6] disabled:opacity-60"
              />
            </Reveal>
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {roadmapPlans.map((plan, index) => (
              <Reveal key={plan.name} delay={index * 90} className="h-full">
                <div className="h-full rounded-2xl border border-dashed border-[#a3b3c6] bg-[#f6f9fc] p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xl font-semibold tracking-tight text-[#0a2540]">{plan.name}</h3>
                    <span className="flex-none rounded-full border border-[#e6ebf1] bg-white px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-[#6b7c93]">
                      Coming later
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[#425466]">{plan.note}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 [clip-path:polygon(0_10%,100%_0,100%_100%,0_100%)]"
        >
          <div className="mk-mesh mk-mesh-drift absolute -inset-[12%]" />
        </div>
        <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-32 text-center sm:px-6 lg:px-8 lg:py-40">
          <Reveal>
            <h2 className="text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.03em] text-white [text-shadow:0_1px_24px_rgba(10,37,64,0.25)] sm:text-6xl">
              Ready to stop guessing what to build?
            </h2>
          </Reveal>
          <Reveal delay={100}>
            <p className="mt-6 max-w-2xl text-base leading-8 text-white/90 [text-shadow:0_1px_12px_rgba(10,37,64,0.2)] sm:text-lg">
              Subscribe as a Founding Member today, then manage billing anytime from your dashboard settings.
            </p>
          </Reveal>
          <Reveal delay={200} className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Link
              href="/login?next=/pricing&checkout=founding"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#0a2540] shadow-[0_8px_24px_-6px_rgba(10,37,64,0.35)] transition hover:-translate-y-0.5"
            >
              Login and subscribe
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <Link
              href="/api-docs"
              className="group inline-flex h-12 items-center justify-center gap-1.5 text-sm font-semibold text-white transition hover:text-white/80"
            >
              Read the API docs
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </Reveal>
          <Reveal delay={280}>
            <p className="mt-6 font-mono text-xs text-white/75">$49/mo, tax included · Cancel anytime</p>
          </Reveal>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
