import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, KeyRound, LockKeyhole, ServerCog } from "lucide-react";
import { FaqSchema } from "@/components/faq-schema";
import { MarketingCtaLink } from "@/components/marketing-cta-link";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";
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

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f2] text-zinc-950">
      <FaqSchema faqs={developerFaqs} />
      <MarketingHeader />

      <section className="border-b border-zinc-200">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 sm:py-16 lg:grid-cols-[1fr_420px] lg:px-8 lg:py-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">API reference</p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl">
              Connect agents and scripts to reviewed keyword research workflows.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-600">
              Discover Keywords APIs are authenticated, quota-aware, and designed to preserve shared-cache behavior
              for student and operator workflows.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <MarketingCtaLink
                href="/register"
                location="hero"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800"
              >
                {publicSignupCta()}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </MarketingCtaLink>
              <Link
                href="/dashboard"
                className="inline-flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-900 hover:border-zinc-400"
              >
                Open dashboard
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <ServerCog className="h-5 w-5 text-emerald-700" aria-hidden="true" />
              <h2 className="font-semibold text-zinc-950">Base URL</h2>
            </div>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-sm text-zinc-100">
              <code>https://discoverkeywords.co</code>
            </pre>
            <p className="mt-4 text-sm leading-6 text-zinc-600">
              All research endpoints require authentication. Public pages are static and do not call research APIs.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Authentication</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">
              Supported authentication for protected requests.
            </h2>
          </div>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {authOptions.map((option) => (
              <div key={option.title} className="rounded-lg border border-zinc-200 bg-[#fbfbf8] p-5">
                <KeyRound className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                <h3 className="mt-5 text-lg font-semibold text-zinc-950">{option.title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{option.text}</p>
                <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
                  <code>{option.code}</code>
                </pre>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[340px_1fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-amber-700">Quota and cache</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950">Guardrails are part of the API contract.</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {quotas.map((quota) => (
              <div key={quota} className="flex gap-3 rounded-lg border border-zinc-200 bg-white p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-emerald-700" aria-hidden="true" />
                <p className="text-sm leading-6 text-zinc-600">{quota}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Endpoints</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950 sm:text-4xl">Core API surfaces.</h2>
          </div>
          <div className="mt-8 grid gap-6">
            {endpoints.map((group) => (
              <div key={group.group} className="rounded-lg border border-zinc-200 bg-[#fbfbf8] p-5">
                <h3 className="text-xl font-semibold text-zinc-950">{group.group}</h3>
                <div className="mt-5 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  {group.items.map(([method, path, summary]) => (
                    <div
                      key={`${method}-${path}`}
                      className="grid gap-2 border-b border-zinc-200 p-4 last:border-b-0 md:grid-cols-[90px_1fr_1.4fr]"
                    >
                      <span className="w-fit rounded-md bg-zinc-950 px-2 py-1 text-xs font-semibold text-white">
                        {method}
                      </span>
                      <code className="text-sm font-semibold text-zinc-950">{path}</code>
                      <p className="text-sm leading-6 text-zinc-600">{summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">BYOK API flow</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950">Quote, explicitly confirm, then poll.</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              Create a dedicated dashboard API key with <code>byok:execute</code>. Provider credentials are saved and
              verified in account settings and are never sent in research API payloads. Reuse the same Idempotency-Key
              when retrying a request after a network failure.
            </p>
          </div>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white p-5">
              <h3 className="font-semibold">curl</h3>
              <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-6 text-zinc-100"><code>{`TOKEN="gk_live_..."
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
  "$BASE/api/research/byok/pipeline/history?limit=20"`}</code></pre>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-5">
              <h3 className="font-semibold">TypeScript</h3>
              <pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-6 text-zinc-100"><code>{`const headers = {
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
).then((response) => response.json());`}</code></pre>
            </div>
          </div>
          <div className="mt-5 rounded-lg border border-zinc-200 bg-white p-5 text-sm leading-6 text-zinc-600">
            <h3 className="font-semibold text-zinc-950">Contract and retry rules</h3>
            <p className="mt-2">
              A quote includes the aggregate upper bound, expiry, batch count, and Provider/stage cost summary.
              Supply either <code>days</code> or a <code>dateFrom</code>/<code>dateTo</code> pair. Poll until the Job is
              <code>complete</code>, <code>partial</code>, or <code>failed</code>; a partial Job can still contain a
              standards-compatible result. For a partial Job, call its retry/quote endpoint and explicitly confirm
              that quote through the matching expand/execute or compare/execute endpoint.
            </p>
            <p className="mt-2">
              Reuse the exact same Idempotency-Key and request body after a timeout. Reusing a key with different
              content returns <code>IDEMPOTENCY_CONFLICT</code>. Other stable rejection codes include
              <code>QUOTE_EXPIRED</code>, <code>COST_CONFIRMATION_MISMATCH</code>,
              <code>DAILY_BUDGET_EXCEEDED</code>, <code>CONCURRENCY_LIMIT_REACHED</code>, and
              <code>JOB_NOT_FOUND</code>.
            </p>
            <p className="mt-2">
              <code>gk_live_*</code> identifies the Discover Keywords caller; Provider Connections hold the user&apos;s
              encrypted DataForSEO/OpenRouter credentials; <code>byok:execute</code> authorizes that API key to spend
              the owner&apos;s Provider allowance. Provider Connection lifecycle operations remain cookie-only in account
              settings, and Provider secrets are never accepted by these research endpoints.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-zinc-950 text-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col justify-between gap-5 px-4 py-12 sm:px-6 md:flex-row md:items-center lg:px-8">
          <div>
            <div className="flex items-center gap-3">
              <LockKeyhole className="h-5 w-5 text-emerald-300" aria-hidden="true" />
              <h2 className="text-2xl font-semibold">Protected APIs, public documentation.</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Use API keys from the authenticated dashboard. Admin, cron, D1, and shared-cache workflows remain unchanged.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-zinc-950 hover:bg-zinc-100"
          >
            Open dashboard
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="border-t border-zinc-200 bg-[#f7f7f2]">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[360px_1fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Developer FAQ</p>
            <h2 className="mt-3 text-3xl font-semibold text-zinc-950">Operational details for safe API use.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {developerFaqs.map((item) => (
              <div key={item.question} className="rounded-lg border border-zinc-200 bg-white p-5">
                <h3 className="font-semibold text-zinc-950">{item.question}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-600">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <MarketingFooter />
    </main>
  );
}
