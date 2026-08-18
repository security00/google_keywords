import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, KeyRound, LockKeyhole, ServerCog } from "lucide-react";
import { FaqSchema } from "@/components/faq-schema";
import { MarketingCtaLink } from "@/components/marketing-cta-link";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
import { Reveal } from "@/components/marketing/reveal";
import { SectionHeading } from "@/components/marketing/section-heading";
import { marketingPageMetadata } from "@/lib/marketing-metadata";
import { publicSignupCta } from "@/lib/public-signup";

export const dynamic = "force-static";

export const metadata: Metadata = {
  ...marketingPageMetadata({
    title: "API Docs | Discover Keywords",
    description:
      "Authentication, quota, and endpoint reference for Discover Keywords research APIs and protected dashboard workflows.",
    path: "/api-docs",
  }),
};

const authOptions = [
  {
    title: "Bearer token",
    text: "Recommended for scripts, agents, and external skill integrations.",
    code: "Authorization: Bearer gk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    title: "Bearer polling",
    text: "Use the same Authorization header when polling asynchronous job status.",
    code: "POST /api/research/expand/status?jobId=...\nAuthorization: Bearer gk_live_xxx",
  },
  {
    title: "Session cookie",
    text: "Used by the authenticated dashboard after a user signs in.",
    code: "Cookie: session=<managed by the web app>",
  },
];

const endpoints = [
  {
    group: "Authentication",
    items: [
      ["POST", "/api/auth/sign-up", "Create a student account with an invite code."],
      ["POST", "/api/auth/sign-in", "Sign in and receive a managed session cookie."],
      ["GET", "/api/auth/access", "Check account role, trial status, quota, and block status."],
      ["POST", "/api/auth/keys", "Generate an API key for integrations."],
      ["GET", "/api/auth/keys", "List active API keys for the current account."],
      ["DELETE", "/api/auth/keys", "Revoke an API key."],
    ],
  },
  {
    group: "Research",
    items: [
      ["POST", "/api/research/expand", "Submit keyword expansion jobs."],
      ["POST", "/api/research/expand/status", "Advance an owned expansion job and return its status."],
      ["POST", "/api/research/compare", "Compare keyword groups and trend movement."],
      ["POST", "/api/research/compare/status", "Advance an owned compare job and return its status."],
      ["POST", "/api/research/serp", "Run guarded SERP analysis for validated research flows."],
      ["POST", "/api/research/trends", "Submit trend checks."],
    ],
  },
  {
    group: "BYOK real-time pipeline",
    items: [
      ["GET", "/api/research/byok/readiness", "Check verified Provider connections, budget, and concurrency."],
      ["POST", "/api/research/byok/pipeline/expand/quote", "Quote multi-seed expansion and semantic filtering."],
      ["POST", "/api/research/byok/pipeline/expand/execute", "Confirm one aggregate quote and start the private expansion job."],
      ["POST", "/api/research/byok/pipeline/compare/quote", "Quote a private comparison of up to 50 keywords."],
      ["POST", "/api/research/byok/pipeline/compare/execute", "Confirm one aggregate quote and start the private compare job."],
      ["GET", "/api/research/byok/pipeline/jobs/{jobId}", "Poll an owner-scoped BYOK pipeline job and read its result."],
      ["POST", "/api/research/byok/pipeline/jobs/{jobId}/retry/quote", "Quote only failed or partial stages; successful Provider work is reused."],
      ["GET", "/api/research/byok/pipeline/history", "List owner-scoped BYOK pipeline history."],
    ],
  },
  {
    group: "Game and discovery",
    items: [
      ["GET", "/api/game-keywords", "Read reviewed game keyword opportunities."],
      ["GET", "/api/integrations/discovery-feed", "Read the protected discovery feed for integrations."],
      ["POST", "/api/research/keyword-suggestions", "Request guarded keyword suggestions."],
    ],
  },
];

const quotas = [
  "Admin accounts are unrestricted.",
  "Student accounts have a daily quota for combined research calls.",
  "Shared-cache hits do not count against quota.",
  "Public marketing pages do not trigger paid research providers.",
];

const developerFaqs = [
  {
    question: "Where do API keys come from?",
    answer:
      "API keys are generated from the authenticated dashboard. Public documentation pages do not create, expose, or validate keys.",
  },
  {
    question: "Which authentication method should scripts use?",
    answer:
      "Bearer tokens are recommended for scripts, agents, and server-side integrations because they avoid leaking keys through URLs.",
  },
  {
    question: "Do shared-cache hits count against quota?",
    answer:
      "No. Shared-cache hits are treated separately from paid research work and do not count against student daily research quota.",
  },
  {
    question: "How should async research jobs be consumed?",
    answer:
      "Submit the job through the protected endpoint, store the returned job id, and POST the matching status endpoint until cached final results are ready. Legacy GET execution remains temporarily available during migration.",
  },
  {
    question: "Can unauthenticated visitors call research APIs from this page?",
    answer:
      "No. The docs page is static and public, but research endpoints remain authenticated and quota-aware.",
  },
  {
    question: "Do API docs change cron, D1, or background workflows?",
    answer:
      "No. This page documents the existing surfaces and does not modify cron jobs, D1 schema, shared cache, or provider call behavior.",
  },
];

const methodStyles: Record<string, string> = {
  GET: "border-[#00a3c4]/25 bg-[#00a3c4]/[0.08] text-[#0081a0]",
  POST: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700",
  DELETE: "border-rose-500/25 bg-rose-500/[0.08] text-rose-600",
};

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`w-fit rounded-md border px-2 py-1 font-mono text-[11px] font-semibold ${
        methodStyles[method] ?? "border-[#e6ebf1] bg-[#f6f9fc] text-[#425466]"
      }`}
    >
      {method}
    </span>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-[#0a2540] shadow-[0_16px_48px_-16px_rgba(10,37,64,0.4)]">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="h-2 w-2 rounded-full bg-rose-400/70" />
          <span className="h-2 w-2 rounded-full bg-amber-400/70" />
          <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
        </div>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
          {label}
        </span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-6 text-white/85">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-[#635bff]/20 bg-[#635bff]/[0.06] px-1.5 py-0.5 font-mono text-[0.8125rem] text-[#635bff]">
      {children}
    </code>
  );
}

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen bg-white text-[#425466]">
      <FaqSchema faqs={developerFaqs} />
      <MarketingHeader />

      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 [clip-path:polygon(0_0,100%_0,100%_calc(100%_-_72px),0_100%)]">
          <div className="mk-mesh mk-mesh-drift absolute -inset-[12%]" />
        </div>

        <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-4 pb-24 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1fr_420px] lg:items-center lg:px-8 lg:pb-28">
          <div>
            <Reveal>
              <div className="inline-flex items-center gap-2.5 rounded-full border border-white/35 bg-white/15 px-4 py-1.5 text-xs font-medium text-white backdrop-blur sm:text-sm">
                <span className="relative flex h-2 w-2">
                  <span className="mk-signal-ping absolute inline-flex h-full w-full rounded-full bg-white" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
                API reference
              </div>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="mt-7 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-white [text-shadow:0_1px_24px_rgba(10,37,64,0.25)] sm:text-5xl lg:text-6xl">
                Connect agents and scripts to reviewed keyword research workflows.
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 max-w-xl text-base leading-8 text-white/90 [text-shadow:0_1px_12px_rgba(10,37,64,0.2)] sm:text-lg">
                Discover Keywords APIs are authenticated, quota-aware, and designed to preserve shared-cache
                behavior for student and operator workflows.
              </p>
            </Reveal>
            <Reveal delay={240} className="mt-9 flex flex-col gap-3 sm:flex-row">
              <MarketingCtaLink
                href="/register"
                location="hero"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#0a2540] shadow-[0_8px_24px_-6px_rgba(10,37,64,0.35)] transition hover:-translate-y-0.5"
              >
                {publicSignupCta()}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </MarketingCtaLink>
              <Link
                href="/dashboard"
                className="inline-flex h-12 items-center justify-center rounded-full border border-white/40 bg-white/10 px-7 text-sm font-semibold text-white backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/20"
              >
                Open dashboard
              </Link>
            </Reveal>
          </div>

          <Reveal delay={160} className="relative">
            <div className="relative rounded-2xl border border-[#e6ebf1] bg-white p-6 mk-shadow-lift">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#635bff] text-white shadow-md shadow-[#635bff]/30">
                  <ServerCog className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="font-semibold tracking-tight text-[#0a2540]">Base URL</h2>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b7c93]">
                    Production
                  </p>
                </div>
              </div>
              <div className="mt-5">
                <CodeBlock label="https" code="https://discoverkeywords.co" />
              </div>
              <p className="mt-4 text-sm leading-6 text-[#425466]">
                All research endpoints require authentication. Public pages are static and do not call research APIs.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <SectionHeading
            eyebrow="Authentication"
            title="Supported authentication for protected requests."
            description="Every research endpoint is authenticated. Pick the credential style that matches your integration."
          />
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {authOptions.map((option, index) => (
              <Reveal key={option.title} delay={index * 90} className="h-full">
                <div className="flex h-full flex-col rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)]">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0073e6] text-white shadow-md shadow-[#0073e6]/30">
                    <KeyRound className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-6 text-lg font-semibold tracking-tight text-[#0a2540]">{option.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#425466]">{option.text}</p>
                  <pre className="mt-5 overflow-x-auto rounded-lg bg-[#0a2540] p-3.5 font-mono text-xs leading-6 text-cyan-200/90">
                    <code>{option.code}</code>
                  </pre>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-[#f6f9fc]">
        <div className="relative mx-auto grid w-full max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[340px_1fr] lg:items-center lg:px-8 lg:py-32">
          <SectionHeading
            eyebrow="Quota and cache"
            title="Guardrails are part of the API contract."
            description="Predictable limits keep research fast, fair, and cache-friendly for every account."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {quotas.map((quota, index) => (
              <Reveal key={quota} delay={index * 80} className="h-full">
                <div className="flex h-full gap-3 rounded-2xl border border-[#e6ebf1] bg-white p-5">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-600" aria-hidden="true" />
                  <p className="text-sm leading-6 text-[#425466]">{quota}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-white">
        <div className="relative mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <SectionHeading
            eyebrow="Endpoints"
            title="Core API surfaces."
            description="All routes are relative to the production base URL and require authentication."
          />
          <div className="mt-14 grid gap-6">
            {endpoints.map((group, groupIndex) => (
              <Reveal key={group.group} delay={groupIndex * 60}>
                <div className="overflow-hidden rounded-2xl border border-[#e6ebf1] bg-white">
                  <div className="flex items-center justify-between gap-4 border-b border-[#e6ebf1] bg-[#f6f9fc] px-6 py-4">
                    <h3 className="text-lg font-semibold tracking-tight text-[#0a2540]">{group.group}</h3>
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b7c93]">
                      {group.items.length} routes
                    </span>
                  </div>
                  <div>
                    {group.items.map(([method, path, summary]) => (
                      <div
                        key={`${method}-${path}`}
                        className="grid gap-2.5 border-b border-[#e6ebf1] px-6 py-4 last:border-b-0 md:grid-cols-[90px_1.2fr_1fr] md:items-center"
                      >
                        <MethodBadge method={method} />
                        <code className="font-mono text-[13px] font-semibold text-[#0a2540]">{path}</code>
                        <p className="text-sm leading-6 text-[#425466]">{summary}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-[#f6f9fc]">
        <div className="relative mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8 lg:py-32">
          <SectionHeading eyebrow="BYOK API flow" title="Quote, explicitly confirm, then poll." />
          <Reveal delay={100}>
            <p className="mt-5 max-w-3xl text-sm leading-7 text-[#425466]">
              Create a dedicated dashboard API key with <InlineCode>byok:execute</InlineCode>. Provider credentials
              are saved and verified in account settings and are never sent in research API payloads. Reuse the same{" "}
              <InlineCode>Idempotency-Key</InlineCode> when retrying a request after a network failure.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            <Reveal>
              <CodeBlock label="curl" code={`TOKEN="gk_live_..."
BASE="https://discoverkeywords.co"

curl -H "Authorization: Bearer $TOKEN" \\
  "$BASE/api/research/byok/readiness"

curl -X POST "$BASE/api/research/byok/pipeline/expand/quote" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: expand-example-001" \\
  -d '{"keywords":["ai resume builder"],"days":90,"filterTerms":["news"]}'

# Copy quoteId, requestHash, and estimatedCostUsd from the quote response.
curl -X POST "$BASE/api/research/byok/pipeline/expand/execute" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: execute-expand-example-001" \\
  -d '{"quoteId":"...","requestHash":"...","confirmedEstimatedCostUsd":0.016}'

curl -H "Authorization: Bearer $TOKEN" \\
  "$BASE/api/research/byok/pipeline/jobs/JOB_ID"

# If status is partial, request an additional quote for failed stages only.
curl -X POST "$BASE/api/research/byok/pipeline/jobs/JOB_ID/retry/quote" \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: retry-expand-example-001" \\
  -d '{}'

# Confirm the returned retry quote through the same expand/execute endpoint.
# Successful stages are loaded from private checkpoints and are not repurchased.

curl -H "Authorization: Bearer $TOKEN" \\
  "$BASE/api/research/byok/pipeline/history?limit=20"`} />
            </Reveal>
            <Reveal delay={120}>
              <CodeBlock label="TypeScript" code={`const headers = {
  Authorization: \`Bearer \${process.env.DISCOVER_KEYWORDS_API_KEY}\`,
  "Content-Type": "application/json",
  "Idempotency-Key": crypto.randomUUID(),
};
const quoted = await fetch(
  "https://discoverkeywords.co/api/research/byok/pipeline/compare/quote",
  { method: "POST", headers, body: JSON.stringify({
      keywords, benchmark: "gpts", days: 90,
  }) },
).then((response) => response.json());

// Show quoted.quote.estimatedCostUsd to the operator before executing.
const job = await fetch(
  "https://discoverkeywords.co/api/research/byok/pipeline/compare/execute",
  { method: "POST", headers: { ...headers,
      "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      quoteId: quoted.quote.quoteId,
      requestHash: quoted.quote.requestHash,
      confirmedEstimatedCostUsd: quoted.quote.estimatedCostUsd,
    }) },
).then((response) => response.json());`} />
            </Reveal>
          </div>
          <Reveal delay={160}>
            <div className="mt-6 rounded-2xl border border-[#e6ebf1] bg-white p-6 text-sm leading-7 text-[#425466] sm:p-7">
              <h3 className="font-semibold tracking-tight text-[#0a2540]">Contract and retry rules</h3>
              <p className="mt-3">
                A quote includes the aggregate upper bound, expiry, batch count, and Provider/stage cost summary.
                Supply either <InlineCode>days</InlineCode> or a <InlineCode>dateFrom</InlineCode>/
                <InlineCode>dateTo</InlineCode> pair. Poll until the Job is <InlineCode>complete</InlineCode>,{" "}
                <InlineCode>partial</InlineCode>, or <InlineCode>failed</InlineCode>; a partial Job can still contain
                a standards-compatible result. For a partial Job, call its retry/quote endpoint and explicitly
                confirm that quote through the matching expand/execute or compare/execute endpoint.
              </p>
              <p className="mt-3">
                Reuse the exact same Idempotency-Key and request body after a timeout. Reusing a key with different
                content returns <InlineCode>IDEMPOTENCY_CONFLICT</InlineCode>. Other stable rejection codes include{" "}
                <InlineCode>QUOTE_EXPIRED</InlineCode>, <InlineCode>COST_CONFIRMATION_MISMATCH</InlineCode>,{" "}
                <InlineCode>DAILY_BUDGET_EXCEEDED</InlineCode>, <InlineCode>CONCURRENCY_LIMIT_REACHED</InlineCode>,
                and <InlineCode>JOB_NOT_FOUND</InlineCode>.
              </p>
              <p className="mt-3">
                <InlineCode>gk_live_*</InlineCode> identifies the Discover Keywords caller; Provider Connections hold
                the user&apos;s encrypted DataForSEO/OpenRouter credentials; <InlineCode>byok:execute</InlineCode>{" "}
                authorizes that API key to spend the owner&apos;s Provider allowance. Provider Connection lifecycle
                operations remain cookie-only in account settings, and Provider secrets are never accepted by these
                research endpoints.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#0a2540]">
        <div className="relative mx-auto flex w-full max-w-7xl flex-col justify-between gap-8 px-4 py-20 sm:px-6 md:flex-row md:items-center lg:px-8 lg:py-24">
          <Reveal>
            <div className="flex items-center gap-4">
              <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-white/15 bg-white/10 text-emerald-300">
                <LockKeyhole className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Protected APIs, public documentation.
              </h2>
            </div>
            <p className="mt-4 max-w-xl text-sm leading-7 text-white/65">
              Use API keys from the authenticated dashboard. Admin, cron, D1, and shared-cache workflows remain
              unchanged.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <Link
              href="/dashboard"
              className="inline-flex h-12 flex-none items-center justify-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#0a2540] transition hover:-translate-y-0.5 hover:bg-[#f6f9fc]"
            >
              Open dashboard
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Reveal>
        </div>
      </section>

      <section className="relative border-t border-[#e6ebf1] bg-white">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[360px_1fr] lg:px-8 lg:py-32">
          <SectionHeading
            eyebrow="Developer FAQ"
            title="Operational details for safe API use."
            description="Answers to the most common integration questions."
          />
          <div className="grid gap-4 md:grid-cols-2">
            {developerFaqs.map((item, index) => (
              <Reveal key={item.question} delay={(index % 2) * 90} className="h-full">
                <div className="h-full rounded-2xl border border-[#e6ebf1] bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_2px_4px_rgba(10,37,64,0.05),0_16px_40px_-8px_rgba(10,37,64,0.14)]">
                  <h3 className="font-semibold tracking-tight text-[#0a2540]">{item.question}</h3>
                  <p className="mt-3 text-sm leading-6 text-[#425466]">{item.answer}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
