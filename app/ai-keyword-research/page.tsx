import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing-page";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "AI Keyword Research | Discover Keywords",
  description:
    "Discover reviewed AI product and workflow keyword opportunities from signals, trend checks, SERP validation, and noise-filtered research workflows.",
  alternates: {
    canonical: "https://discoverkeywords.co/ai-keyword-research",
  },
};

export default function AiKeywordResearchPage() {
  return (
    <MarketingPage
      eyebrow="AI keyword research"
      title="Discover AI product keywords before every database shows the same terms."
      description="Discover Keywords watches AI product, agent, workflow, and tool signals, then filters hype and entertainment noise before research spend."
      benefits={[
        "Find AI tool and workflow demand while it is still early enough to build around.",
        "Filter generic AI headlines, entertainment terms, trademark noise, and weak product-fit phrases.",
        "Use reviewed signals as inputs for protected trend, SERP, and opportunity workflows.",
      ]}
      workflow={[
        {
          title: "Collect AI signals",
          text: "Monitor product launches, founder discussions, tool workflows, community posts, and curated feeds for emerging AI demand.",
        },
        {
          title: "Normalize candidates",
          text: "Turn raw mentions into cleaner keyword candidates while preserving enough context to explain why the phrase appeared.",
        },
        {
          title: "Filter hype and noise",
          text: "Reject entertainment IP, generic news, celebrity spikes, trademarks, and vague AI phrases before they reach research queues.",
        },
        {
          title: "Validate buildability",
          text: "Use trend movement, SERP shape, and review evidence to decide whether a tool, guide, comparison, or template page makes sense.",
        },
      ]}
      proof={[
        {
          label: "AI tools",
          title: "Product-led keyword discovery",
          text: "Spot emerging tool and workflow terms before they settle into crowded keyword databases.",
        },
        {
          label: "Noise control",
          title: "Hype is not an opportunity",
          text: "The review layer keeps generic AI news and entertainment signals from becoming fake keyword targets.",
        },
        {
          label: "Operator workflow",
          title: "Signals stay explainable",
          text: "Each candidate keeps source and review context so operators can understand why it deserves attention.",
        },
      ]}
      faqs={[
        {
          question: "Is this just AI keyword lookup?",
          answer:
            "No. It focuses on early AI demand discovery, then routes reviewed candidates toward validation instead of returning a generic keyword export.",
        },
        {
          question: "How does it avoid AI hype terms?",
          answer:
            "Filtering and review gates block weak-fit news, generic AI language, entertainment terms, and protected brand noise before research spend.",
        },
        {
          question: "Does this page call OpenRouter or paid providers?",
          answer:
            "No. This page is static. Heavy LLM, trend, and SERP logic remains behind protected workflows and cache rules.",
        },
        {
          question: "What page types does it support?",
          answer:
            "Reviewed AI signals can support tool pages, comparison pages, guides, templates, workflow pages, and programmatic clusters.",
        },
      ]}
    />
  );
}
