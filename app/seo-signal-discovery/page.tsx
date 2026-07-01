import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing-page";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "SEO Signal Discovery | Discover Keywords",
  description:
    "Turn multi-source SEO signals into reviewed keyword candidates with trend checks, SERP validation, and noise filtering.",
  alternates: {
    canonical: "https://discoverkeywords.co/seo-signal-discovery",
  },
};

export default function SeoSignalDiscoveryPage() {
  return (
    <MarketingPage
      eyebrow="SEO signal discovery"
      title="Turn noisy market signals into reviewed SEO keyword candidates."
      description="Discover Keywords watches multiple signal sources, filters weak-fit noise, and routes only reviewed opportunities toward trend and SERP validation."
      benefits={[
        "Collect demand signals from product, community, search, RSS, and game discovery surfaces.",
        "Reject news-like, entertainment, trademark, and generic phrases before they reach the bridge.",
        "Give operators a review trail for why a signal deserves keyword research time.",
      ]}
      workflow={[
        {
          title: "Watch sources",
          text: "Collect candidates from stable public surfaces such as HN, Reddit, RSS, product signals, and game opportunity feeds.",
        },
        {
          title: "Extract candidates",
          text: "Turn titles and posts into phrase candidates while preserving enough context to understand why the signal appeared.",
        },
        {
          title: "Filter noise",
          text: "Block entertainment IP, celebrity news, sports, trademarks, generic phrases, and weak pipeline-fit terms before review.",
        },
        {
          title: "Bridge approved signals",
          text: "Only accepted signals move toward trend checks, SERP validation, opportunity reports, and protected dashboard workflows.",
        },
      ]}
      proof={[
        {
          label: "Review queue",
          title: "Candidate evidence stays visible",
          text: "Operators can see source, context, reason, and status before deciding whether a signal deserves expansion.",
        },
        {
          label: "Noise control",
          title: "Entertainment and news terms are blocked",
          text: "The system is tuned to avoid turning hot shows, celebrities, and news headlines into fake SEO opportunities.",
        },
        {
          label: "Pipeline safety",
          title: "Approved signals remain gated",
          text: "Signal discovery does not bypass authenticated dashboard, quota, cache, or admin review behavior.",
        },
      ]}
      faqs={[
        {
          question: "What makes a signal useful?",
          answer:
            "A useful signal points to a buildable search intent: a tool, guide, template, comparison, database, game page, or workflow page.",
        },
        {
          question: "Why not ingest everything?",
          answer:
            "Raw trend feeds are full of noise. Review gates reduce wasted research calls and prevent thin pages from being created.",
        },
        {
          question: "Does signal discovery publish pages automatically?",
          answer:
            "No. It surfaces candidates and review context. Page creation and business decisions stay under operator control.",
        },
        {
          question: "Can students trigger paid discovery from this page?",
          answer:
            "No. This page is static. Student-facing research still goes through the shared-cache and protected dashboard paths.",
        },
        {
          question: "How is SEO signal discovery different from keyword research?",
          answer:
            "Signal discovery looks for early demand clues before a keyword is obvious, while keyword research validates whether that clue can become a useful search page.",
        },
        {
          question: "Which signals are rejected before research?",
          answer:
            "News headlines, celebrity spikes, sports events, entertainment IP, trademark noise, generic fragments, and weak product-fit terms are blocked before paid validation.",
        },
      ]}
    />
  );
}
