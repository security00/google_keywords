import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, KeyRound, LockKeyhole, ServerCog } from "lucide-react";
import { FaqSchema } from "@/components/faq-schema";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-chrome";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "API Docs | Discover Keywords",
  description:
    "Authentication, quota, and endpoint reference for Discover Keywords research APIs and protected dashboard workflows.",
  alternates: {
    canonical: "https://discoverkeywords.co/api-docs",
  },
};

const authOptions = [
  {
    title: "Bearer token",
    text: "Recommended for scripts, agents, and external skill integrations.",
    code: "Authorization: Bearer gk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  },
  {
    title: "Query parameter",
    text: "Supported for simple polling and lightweight integrations.",
    code: "GET /api/research/expand/status?jobId=...&api_key=gk_live_xxx",
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
      ["GET", "/api/research/expand/status", "Poll expansion job status and final cached results."],
      ["POST", "/api/research/compare", "Compare keyword groups and trend movement."],
      ["GET", "/api/research/compare/status", "Poll compare job status."],
      ["POST", "/api/research/serp", "Run guarded SERP analysis for validated research flows."],
      ["POST", "/api/research/trends", "Submit trend checks."],
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
      "Submit the job through the protected endpoint, store the returned job id, and poll the matching status endpoint until cached final results are ready.",
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
              <Link
                href="/register"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-zinc-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800"
              >
                Request access
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
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
              Three supported ways to authenticate protected requests.
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
