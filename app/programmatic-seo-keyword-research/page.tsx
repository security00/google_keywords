import { MarketingPage } from "@/components/marketing-page";
import { marketingPageMetadata } from "@/lib/marketing-metadata";

export const dynamic = "force-static";

export const metadata = marketingPageMetadata({
  title: "Programmatic SEO Keyword Research | Discover Keywords",
  description:
    "Choose calculator, generator, template, and comparison page clusters from reviewed demand instead of guessing programmatic SEO templates.",
  path: "/programmatic-seo-keyword-research",
});

export default function ProgrammaticSeoKeywordResearchPage() {
  return (
    <MarketingPage
      eyebrow="Programmatic SEO keyword research"
      title="Prioritize programmatic SEO pages from reviewed demand, not guesswork."
      description="Discover Keywords helps operators decide which templates, tools, comparison pages, and long-tail clusters deserve production work."
      benefits={[
        "Find repeatable page patterns before committing engineering or content production time.",
        "Use SERP fit to separate tool, template, guide, comparison, and game-page intents.",
        "Get heavy trend, SERP, and expansion analysis done for you — no extra provider accounts or tooling needed.",
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
          question: "Do students need their own data provider accounts?",
          answer:
            "No. Trend, SERP, and expansion data are included with membership, so students research inside the product without managing external providers.",
        },
        {
          question: "What should operators build first?",
          answer:
            "Start with opportunities that have clear intent, SERP fit, repeatable page structure, and enough demand evidence to justify production.",
        },
        {
          question: "How do you avoid thin programmatic SEO pages?",
          answer:
            "The workflow checks whether a keyword family has real intent, a useful repeatable page format, and enough evidence before it becomes a page cluster candidate.",
        },
        {
          question: "Can this help choose page templates?",
          answer:
            "Yes. Reviewed signals and SERP shape help separate calculator, generator, template, comparison, guide, game, and database page patterns.",
        },
      ]}
    />
  );
}
