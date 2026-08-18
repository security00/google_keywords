import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { Reveal } from "@/components/marketing/reveal";
import { SectionHeading } from "@/components/marketing/section-heading";
import { caseStudies, type CaseStudy } from "@/lib/marketing-home-content";

const chartShapes: Record<CaseStudy["chart"], { line: string; area: string }> = {
  steady: {
    line: "M4 84C40 82 70 78 100 68C130 58 160 44 200 32C240 21 280 15 316 10",
    area: "M4 84C40 82 70 78 100 68C130 58 160 44 200 32C240 21 280 15 316 10L316 96H4Z",
  },
  hockey: {
    line: "M4 86C60 85 100 84 140 80C180 76 210 66 248 44C278 27 300 16 316 8",
    area: "M4 86C60 85 100 84 140 80C180 76 210 66 248 44C278 27 300 16 316 8L316 96H4Z",
  },
  early: {
    line: "M4 88C50 87 90 82 128 62C154 48 176 40 208 38C248 36 286 34 316 32",
    area: "M4 88C50 87 90 82 128 62C154 48 176 40 208 38C248 36 286 34 316 32L316 96H4Z",
  },
};

export function HomeCaseStudies() {
  return (
    <section id="case-studies" className="relative border-t border-[#e6ebf1] bg-white">
      <div className="relative mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <SectionHeading
            eyebrow="Proof"
            title="Real keywords. Real sites. Real results."
            description="Sites built on opportunities that came out of the radar — with the numbers to show for it."
          />
          <Link
            href="/register"
            className="group inline-flex flex-none items-center gap-2 text-sm font-semibold text-[#635bff] transition hover:text-[#0073e6]"
          >
            Your site could be next
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {caseStudies.map((study, index) => (
            <Reveal key={study.siteName} delay={index * 100} className="h-full">
              <CaseStudyCard study={study} />
            </Reveal>
          ))}
        </div>

        <p className="mt-10 text-center font-mono text-xs text-[#6b7c93]">
          Founder-built sites. Figures updated monthly.
        </p>
      </div>
    </section>
  );
}

function CaseStudyCard({ study }: { study: CaseStudy }) {
  const chart = chartShapes[study.chart];
  const gradientId = `caseTrend-${study.chart}`;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[#e6ebf1] bg-white transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_20px_48px_-12px_rgba(10,37,64,0.16)]">
      <div className="border-b border-[#e6ebf1] bg-[#f6f9fc]">
        <div className="flex items-center gap-2 px-4 pt-3.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#d7dee8]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#d7dee8]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#d7dee8]" />
          <span className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[#e6ebf1] bg-white px-3 py-1 font-mono text-xs text-[#6b7c93]">
            <Lock className="h-3 w-3 flex-none text-[#a3b3c6]" aria-hidden="true" />
            <span className="truncate">{study.siteUrl}</span>
          </span>
        </div>
        <div className="px-4 pb-4 pt-3.5">
          <div className="rounded-lg border border-[#e6ebf1] bg-white p-3">
            <div className="flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b7c93]">
              <span>Organic traffic</span>
              <span>Since launch</span>
            </div>
            <svg className="mt-2 h-24 w-full" viewBox="0 0 320 96" preserveAspectRatio="none" role="img">
              <title>{`Traffic growth for ${study.siteName}`}</title>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#635bff" />
                  <stop offset="55%" stopColor="#0073e6" />
                  <stop offset="100%" stopColor="#00a3c4" />
                </linearGradient>
                <linearGradient id={`${gradientId}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#635bff" stopOpacity="0.14" />
                  <stop offset="100%" stopColor="#635bff" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M4 24H316M4 48H316M4 72H316" stroke="#e6ebf1" strokeWidth="1" />
              <path d={chart.area} fill={`url(#${gradientId}-fill)`} />
              <path
                d={chart.line}
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeLinecap="round"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-[#635bff]/20 bg-[#635bff]/[0.06] px-2 py-1 font-mono text-xs font-medium text-[#635bff]">
            {study.keyword}
          </span>
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
            Score {study.score}
          </span>
          <span className="font-mono text-xs text-[#6b7c93]">Found {study.foundDate}</span>
        </div>

        <h3 className="mt-4 text-lg font-semibold tracking-tight text-[#0a2540]">{study.siteName}</h3>
        <p className="mt-2 text-sm leading-6 text-[#425466]">{study.description}</p>

        <div className="mt-6 grid grid-cols-3 gap-3 border-t border-[#e6ebf1] pt-5">
          {study.metrics.map((metric) => (
            <div key={metric.label}>
              <div className="text-lg font-semibold tracking-tight text-[#0a2540]">{metric.value}</div>
              <div className="mt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-[#6b7c93]">
                {metric.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
