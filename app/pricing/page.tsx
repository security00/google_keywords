import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  LockKeyhole,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { PricingAutoCheckout, PricingCheckoutButton } from "@/components/pricing-cta";
import { FOUNDING_MEMBER_PLAN } from "@/lib/pricing-copy";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Pricing | Discover Keywords",
  description:
    "Start with the Discover Keywords Founding Member plan. Unlock the full opportunity radar, buildable keyword scores, and build brief credits.",
  alternates: {
    canonical: "https://discoverkeywords.co/pricing",
  },
};

const included = [
  "Full Opportunity Radar across new keywords, games, and validated markets",
  "Buildable keyword scores with Build / Watch / Skip decisions",
  "20 Build Brief credits per month for MVP direction and SEO structure",
  "Public samples plus the private opportunity database",
  "SaaS access after course/student trial expires",
  "Billing portal for subscription management",
];

const limits = [
  { label: "Opportunity database", value: "Full access" },
  { label: "Build Briefs", value: "20 / month" },
  { label: "Update model", value: "Shared pipelines" },
  { label: "Best for", value: "Indie hackers and solo builders" },
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

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f2] text-zinc-950">
      <Suspense fallback={null}>
        <PricingAutoCheckout />
      </Suspense>
      <MarketingHeader />

      <section className="border-b border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[0.92fr_1.08fr] lg:px-8 lg:py-20">
          <div className="flex flex-col justify-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Pricing</p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl">
              Founding access for builders who use keyword opportunities to decide what to build.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-600">
              The first public plan is priced to validate serious SaaS demand, not casual keyword lookup. It is for
              indie hackers, SEO-first builders, and AI tool-site operators who can turn one strong opportunity into a
              product, page, or campaign.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <PricingCheckoutButton />
              <Link
                href="/keyword-opportunity-platform"
                className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-900 hover:border-zinc-400"
              >
                See how it works
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-start">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                  <h2 className="text-2xl font-semibold text-zinc-950">{FOUNDING_MEMBER_PLAN.name}</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{FOUNDING_MEMBER_PLAN.summary}</p>
              </div>
              <div className="text-left sm:text-right">
                <div className="text-4xl font-semibold text-zinc-950">{FOUNDING_MEMBER_PLAN.price}</div>
                <div className="text-sm font-medium text-zinc-500">{FOUNDING_MEMBER_PLAN.interval}</div>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {limits.map((item) => (
                <div key={item.label} className="rounded-lg border border-zinc-200 bg-[#fbfbf8] p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{item.label}</div>
                  <div className="mt-1 text-sm font-semibold text-zinc-950">{item.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-3">
              {included.map((item) => (
                <div key={item} className="flex gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-700" aria-hidden="true" />
                  <p className="text-sm leading-6 text-zinc-600">{item}</p>
                </div>
              ))}
            </div>

            <div className="mt-7">
              <PricingCheckoutButton
                label={FOUNDING_MEMBER_PLAN.checkoutLabel}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:opacity-60"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">What You Get</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
              The price is tied to decision value, not raw keyword volume.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600">
              $49/month, tax included, is the early Founding Member price for access to reviewed opportunities,
              evidence, and brief credits. Lower-cost and higher-limit tiers can come later after the first paid beta
              proves usage patterns.
            </p>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                title: "Opportunity Radar",
                text: "Browse buildable keyword opportunities across the three core pipelines.",
                icon: Radar,
              },
              {
                title: "Buildability score",
                text: "Use status, score, risk, and evidence to decide whether to build, watch, or skip.",
                icon: ShieldCheck,
              },
              {
                title: "Build Brief credits",
                text: "Turn selected opportunities into MVP scope, SEO page structure, and next steps.",
                icon: FileText,
              },
              {
                title: "Private database",
                text: "Public pages show samples; paid access unlocks the working opportunity pool.",
                icon: Database,
              },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-zinc-200 bg-[#fbfbf8] p-5">
                <item.icon className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                <h3 className="mt-5 text-lg font-semibold text-zinc-950">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Trials And Students</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
              Course access is still time-limited.
            </h2>
            <p className="mt-4 text-base leading-7 text-zinc-600">
              Student/course accounts can keep using the product during their granted trial window. After that window
              ends, continued SaaS access requires an active subscription.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white p-5">
              <Clock className="h-5 w-5 text-amber-700" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold">90-day course trial</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-600">
                Course users can receive temporary access, but it is not an unlimited free account.
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-5">
              <LockKeyhole className="h-5 w-5 text-amber-700" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold">Subscription after expiry</h3>
              <p className="mt-3 text-sm leading-6 text-zinc-600">
                Once a trial expires, the Opportunity Radar falls back to public samples until billing is active.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Coming Later</p>
              <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
                Multi-tier plans will come after the first paid beta.
              </h2>
            </div>
            <PricingCheckoutButton label="Get founding access" />
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {roadmapPlans.map((plan) => (
              <div key={plan.name} className="rounded-lg border border-dashed border-zinc-300 bg-[#fbfbf8] p-5">
                <h3 className="text-xl font-semibold text-zinc-950">{plan.name}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{plan.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-zinc-950 text-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col justify-between gap-5 px-4 py-12 sm:px-6 md:flex-row md:items-center lg:px-8">
          <div>
            <h2 className="text-2xl font-semibold">Ready to stop guessing what to build?</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Subscribe from the pricing page, then manage billing later from dashboard settings.
            </p>
          </div>
          <Link
            href="/login?next=/pricing&checkout=founding"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-zinc-950 hover:bg-zinc-100"
          >
            Login and subscribe
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
