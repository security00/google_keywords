import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  LineChart,
  Radar,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";
import { MarketingFooter, MarketingHeader, solutionLinks } from "@/components/marketing-chrome";
import { ProductEvidencePreview } from "@/components/product-evidence-preview";

type MarketingPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  primaryCta?: string;
  secondaryCta?: string;
  benefits: string[];
  workflow: Array<{
    title: string;
    text: string;
  }>;
  proof: Array<{
    label: string;
    title: string;
    text: string;
  }>;
  faqs: Array<{
    question: string;
    answer: string;
  }>;
};

const workflowIcons = [Radar, ShieldCheck, SearchCheck, LineChart];

export function MarketingPage({
  eyebrow,
  title,
  description,
  primaryCta = "Request access",
  secondaryCta = "Open dashboard",
  benefits,
  workflow,
  proof,
  faqs,
}: MarketingPageProps) {
  return (
    <main className="min-h-screen bg-[#f7f7f2] text-zinc-950">
      <MarketingHeader />

      <section className="border-b border-zinc-200">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[1fr_440px] lg:px-8 lg:py-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">{eyebrow}</p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl">
              {title}
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-600">{description}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/register"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800"
              >
                {primaryCta}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-900 hover:border-zinc-400"
              >
                {secondaryCta}
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">What this page covers</h2>
            <div className="mt-5 grid gap-3">
              {benefits.map((benefit) => (
                <div key={benefit} className="flex gap-3 rounded-lg border border-zinc-200 bg-[#fbfbf8] p-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-700" aria-hidden="true" />
                  <p className="text-sm leading-6 text-zinc-600">{benefit}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Workflow</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
              A practical path from raw demand signal to buildable keyword decision.
            </h2>
          </div>
          <div className="mt-9 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {workflow.map((step, index) => {
              const Icon = workflowIcons[index % workflowIcons.length];

              return (
                <div key={step.title} className="rounded-lg border border-zinc-200 bg-[#fbfbf8] p-5">
                  <Icon className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                  <h3 className="mt-5 text-lg font-semibold text-zinc-950">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-zinc-600">{step.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Examples</p>
              <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
                Public examples, private workflows protected.
              </h2>
              <p className="mt-4 text-base leading-7 text-zinc-600">
                The preview mirrors the review dashboard style with anonymized keywords and safe product metrics.
              </p>
            </div>
            <ProductEvidencePreview compact />
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {proof.map((item) => (
              <div key={item.title} className="rounded-lg border border-zinc-200 bg-white p-5">
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                  {item.label}
                </span>
                <h3 className="mt-5 text-xl font-semibold text-zinc-950">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[360px_1fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">FAQ</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950">How it stays operationally safe.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {faqs.map((item) => (
              <div key={item.question} className="rounded-lg border border-zinc-200 bg-[#fbfbf8] p-5">
                <h3 className="font-semibold text-zinc-950">{item.question}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Related pages</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
              Explore more keyword discovery workflows.
            </h2>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {solutionLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="group rounded-lg border border-zinc-200 bg-white p-5 hover:border-emerald-300"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-zinc-950">{link.label}</h3>
                  <ArrowRight className="h-4 w-4 flex-none text-zinc-400 group-hover:text-emerald-700" aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-600">
                  Read how Discover Keywords handles this search intent with reviewed signals and protected workflows.
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-zinc-950 text-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col justify-between gap-5 px-4 py-12 sm:px-6 md:flex-row md:items-center lg:px-8">
          <div>
            <h2 className="text-2xl font-semibold">Use reviewed demand signals before they become crowded terms.</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              The public pages explain the product. The working dashboard, API keys, and admin tools remain protected.
            </p>
          </div>
          <Link
            href="/register"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-zinc-950 hover:bg-zinc-100"
          >
            Request access
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
