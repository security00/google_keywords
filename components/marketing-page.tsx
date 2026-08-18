import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  LineChart,
  Plus,
  Radar,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";
import { FaqSchema, type FAQItem } from "@/components/faq-schema";
import { MarketingCtaLink } from "@/components/marketing-cta-link";
import { MarketingFooter, MarketingHeader, solutionLinks } from "@/components/marketing-chrome";
import { Reveal } from "@/components/marketing/reveal";
import { SectionHeading } from "@/components/marketing/section-heading";
import { ProductEvidencePreview } from "@/components/product-evidence-preview";
import { publicSignupCta } from "@/lib/public-signup";

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
  faqs: FAQItem[];
};

const workflowIcons = [Radar, ShieldCheck, SearchCheck, LineChart];
const workflowAccents = ["#635bff", "#0073e6", "#00a3c4", "#a960ee"];

export function MarketingPage({
  eyebrow,
  title,
  description,
  primaryCta = publicSignupCta(),
  secondaryCta = "Open dashboard",
  benefits,
  workflow,
  proof,
  faqs,
}: MarketingPageProps) {
  return (
    <main className="min-h-screen bg-white text-[#425466]">
      <FaqSchema faqs={faqs} />
      <MarketingHeader />

      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 [clip-path:polygon(0_0,100%_0,100%_calc(100%_-_72px),0_100%)]">
          <div className="mk-mesh mk-mesh-drift absolute -inset-[12%]" />
        </div>

        <div className="relative mx-auto grid w-full max-w-7xl gap-14 px-4 pb-24 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1fr_440px] lg:items-center lg:px-8 lg:pb-28">
          <div>
            <Reveal>
              <p className="inline-flex w-fit items-center gap-2 rounded-full border border-white/35 bg-white/15 px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-white backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
                {eyebrow}
              </p>
            </Reveal>
            <Reveal delay={90}>
              <h1 className="mt-7 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-white [text-shadow:0_1px_24px_rgba(10,37,64,0.25)] sm:text-5xl lg:text-6xl">
                {title}
              </h1>
            </Reveal>
            <Reveal delay={180}>
              <p className="mt-6 max-w-xl text-base leading-8 text-white/90 [text-shadow:0_1px_12px_rgba(10,37,64,0.2)] sm:text-lg">{description}</p>
            </Reveal>
            <Reveal delay={270} className="mt-10 flex flex-col gap-3 sm:flex-row">
              <MarketingCtaLink
                href="/register"
                location="solution"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#0a2540] shadow-[0_8px_24px_-6px_rgba(10,37,64,0.35)] transition hover:-translate-y-0.5"
              >
                {primaryCta}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </MarketingCtaLink>
              <Link
                href="/dashboard"
                className="inline-flex h-12 items-center justify-center rounded-full border border-white/40 bg-white/10 px-7 text-sm font-semibold text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/20"
              >
                {secondaryCta}
              </Link>
            </Reveal>
          </div>

          <Reveal delay={200} className="relative">
            <div className="relative rounded-3xl border border-[#e6ebf1] bg-white p-7 mk-shadow-lift sm:p-8">
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b7c93]">
                What this page covers
              </h2>
              <ul className="mt-6 grid gap-3">
                {benefits.map((benefit) => (
                  <li
                    key={benefit}
                    className="flex gap-3 rounded-xl border border-[#e6ebf1] bg-[#f6f9fc] px-4 py-3.5"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" aria-hidden="true" />
                    <p className="text-sm leading-6 text-[#425466]">{benefit}</p>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-[#f6f9fc]">
        <div className="relative mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <SectionHeading
            eyebrow="Workflow"
            title="A practical path from raw demand signal to buildable keyword decision."
            description="Every opportunity you review has already passed through these steps — so your research time goes to ideas that were worth building in the first place."
          />
          <div className="relative mt-16">
            <div
              aria-hidden="true"
              className="absolute left-0 right-0 top-6 hidden h-px bg-[#d7dee8] lg:block"
            />
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {workflow.map((step, index) => {
                const Icon = workflowIcons[index % workflowIcons.length];
                const accent = workflowAccents[index % workflowAccents.length];

                return (
                  <Reveal key={step.title} delay={index * 100} className="h-full">
                    <div className="h-full rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)]">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-md"
                        style={{ backgroundColor: accent, boxShadow: `0 8px 20px -6px ${accent}55` }}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <h3 className="mt-6 text-lg font-semibold tracking-tight text-[#0a2540]">{step.title}</h3>
                      <p className="mt-3 text-sm leading-6 text-[#425466]">{step.text}</p>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-white">
        <div className="relative mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <SectionHeading
              eyebrow="Examples"
              title="See what a reviewed opportunity looks like."
              description="An anonymized preview of the evidence members use to decide what to build next — trend movement, intent checks, and review notes included."
            />
            <Reveal delay={150}>
              <ProductEvidencePreview compact />
            </Reveal>
          </div>
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {proof.map((item, index) => (
              <Reveal key={item.title} delay={index * 90} className="h-full">
                <div className="h-full rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)]">
                  <span className="rounded-md border border-[#635bff]/20 bg-[#635bff]/[0.06] px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#635bff]">
                    {item.label}
                  </span>
                  <h3 className="mt-5 text-xl font-semibold tracking-tight text-[#0a2540]">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#425466]">{item.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-[#f6f9fc]">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[380px_1fr] lg:px-8 lg:py-32">
          <div>
            <SectionHeading
              eyebrow="FAQ"
              title="Questions operators ask before subscribing."
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
              {faqs.map((item) => (
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

      <section className="relative border-t border-[#e6ebf1] bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <SectionHeading eyebrow="Related pages" title="Explore more keyword discovery workflows." />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {solutionLinks.map((link, index) => (
              <Reveal key={link.href} delay={(index % 3) * 80} className="h-full">
                <Link
                  href={link.href}
                  className="group flex h-full flex-col rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-lg font-semibold tracking-tight text-[#0a2540]">{link.label}</h3>
                    <ArrowUpRight
                      className="mt-1 h-5 w-5 flex-none text-[#a3b3c6] transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#635bff]"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-4 text-sm leading-6 text-[#425466]">
                    See how Discover Keywords turns this search intent into reviewed, buildable opportunities.
                  </p>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="absolute inset-0 [clip-path:polygon(0_12%,100%_0,100%_100%,0_100%)]"
        >
          <div className="mk-mesh mk-mesh-drift absolute -inset-[12%]" />
        </div>
        <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-32 text-center sm:px-6 lg:px-8 lg:py-40">
          <Reveal>
            <h2 className="text-balance text-4xl font-semibold leading-[1.04] tracking-[-0.03em] text-white [text-shadow:0_1px_24px_rgba(10,37,64,0.25)] sm:text-6xl">
              Use reviewed demand signals before they become crowded terms.
            </h2>
          </Reveal>
          <Reveal delay={100}>
            <p className="mt-6 max-w-2xl text-base leading-8 text-white/90 [text-shadow:0_1px_12px_rgba(10,37,64,0.2)] sm:text-lg">
              Membership unlocks the working dashboard, the full opportunity database, and the evidence behind
              every reviewed keyword.
            </p>
          </Reveal>
          <Reveal delay={200} className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Link
              href="/register"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#0a2540] shadow-[0_8px_24px_-6px_rgba(10,37,64,0.35)] transition hover:-translate-y-0.5"
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
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
