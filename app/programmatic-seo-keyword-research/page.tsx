import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing-page";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Programmatic SEO Keyword Research | Discover Keywords",
  description:
    "Research programmatic SEO opportunities with reviewed signals, SERP-fit checks, trend validation, and shared-cache guarded workflows.",
  alternates: {
    canonical: "https://discoverkeywords.co/programmatic-seo-keyword-research",
  },
};

export default function ProgrammaticSeoKeywordResearchPage() {
  return (
    <MarketingPage
      eyebrow="Programmatic SEO keyword research"
      title="Prioritize programmatic SEO pages from reviewed demand, not guesswork."
      description="Discover Keywords helps operators decide which templates, tools, comparison pages, and long-tail clusters deserve production work."
      benefits={[
        "Find repeatable page patterns before committing engineering or content production time.",
        "Use SERP fit to separate tool, template, guide, comparison, and game-page intents.",
        "Keep heavy trend, SERP, and expansion logic behind existing protected research workflows.",
      ]}
      workflow={[
        {
          title: "Detect patterns",
          text: "Group similar demand signals into candidate page families such as calculators, generators, templates, guides, and game pages.",
        },
        {
          title: "Check intent fit",
          text: "Look for SERP shapes that support a repeatable page type instead of forcing every keyword into the same template.",
        },
        {
          title: "Prioritize clusters",
          text: "Use trend movement, opportunity scoring, and review notes to decide which page clusters deserve rollout first.",
        },
        {
          title: "Protect production",
          text: "Keep automatic publishing, source weighting, and recommendation changes under human control until feedback is sufficient.",
        },
      ]}
      proof={[
        {
          label: "Template pages",
          title: "Calculators and generators",
          text: "Discover repeatable utility intents where a small productized page can outperform generic article content.",
        },
        {
          label: "Game pages",
          title: "New game opportunity clusters",
          text: "Use game relevance, trend checks, and SERP validation before adding new game keyword pages.",
        },
        {
          label: "Content systems",
          title: "Topic clusters with review history",
          text: "Give editors and agents a clear reason for why a cluster is worth building now.",
        },
      ]}
      faqs={[
        {
          question: "Is this automatic programmatic SEO publishing?",
          answer:
            "No. It helps identify and validate opportunities. Publishing, templates, and site-specific rollout remain separate decisions.",
        },
        {
          question: "Why use signals before keyword databases?",
          answer:
            "Programmatic SEO works best when you find a repeatable pattern early, before all competitors see the same query set.",
        },
        {
          question: "Does it require direct student access to paid APIs?",
          answer:
            "No. Student workflows stay on shared cache and protected research endpoints rather than direct paid provider calls.",
        },
        {
          question: "What should operators build first?",
          answer:
            "Start with opportunities that have clear intent, SERP fit, repeatable page structure, and enough demand evidence to justify production.",
        },
      ]}
    />
  );
}
