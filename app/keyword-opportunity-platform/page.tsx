import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing-page";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Keyword Opportunity Platform | Discover Keywords",
  description:
    "Find reviewed keyword opportunities from search signals, trend checks, SERP validation, and guarded discovery workflows.",
  alternates: {
    canonical: "https://discoverkeywords.co/keyword-opportunity-platform",
  },
};

export default function KeywordOpportunityPlatformPage() {
  return (
    <MarketingPage
      eyebrow="Keyword opportunity platform"
      title="Find keyword opportunities before they are obvious in traditional databases."
      description="Discover Keywords is built for operators who need early, reviewed, and buildable opportunities instead of another spreadsheet of already-crowded keywords."
      benefits={[
        "Track demand signals before they settle into crowded keyword tools.",
        "Filter entertainment, news, brand, and short-lived noise before research spend.",
        "Keep the working dashboard protected while explaining the opportunity workflow publicly.",
      ]}
      workflow={[
        {
          title: "Collect early signals",
          text: "Monitor product, founder, SEO, game, and AI workflow signals that can reveal new keyword demand before it becomes obvious.",
        },
        {
          title: "Review for buildability",
          text: "Block weak-fit phrases, generic news, celebrity terms, and protected brand noise before they enter the opportunity queue.",
        },
        {
          title: "Validate with SERP shape",
          text: "Check whether the search results support a tool, guide, database, template, or comparison page before prioritizing work.",
        },
        {
          title: "Act with confidence",
          text: "Turn approved demand into practical briefs for content, tool pages, game pages, and student research workflows.",
        },
      ]}
      proof={[
        {
          label: "Tool site",
          title: "Calculator and generator opportunities",
          text: "Spot buildable utility terms where a lightweight tool page can satisfy the intent better than a generic blog post.",
        },
        {
          label: "Content site",
          title: "Reviewed topic clusters",
          text: "Separate durable demand from short-lived social noise before assigning pages to writers or agents.",
        },
        {
          label: "Operator workflow",
          title: "Shared-cache friendly discovery",
          text: "Students and operators use reviewed cached outputs without accidentally triggering paid research calls from the public site.",
        },
      ]}
      faqs={[
        {
          question: "Is this a replacement for keyword lookup tools?",
          answer:
            "No. It focuses on opportunity discovery before a term becomes widely visible, then uses validation gates before recommending action.",
        },
        {
          question: "Does the public page trigger paid calls?",
          answer:
            "No. These SEO pages are static and do not call DataForSEO, OpenRouter, SERP, D1, or any protected dashboard endpoint.",
        },
        {
          question: "Who is it for?",
          answer:
            "SEO operators, tool-site builders, game-site builders, and students who need reviewed opportunities instead of raw scraped noise.",
        },
        {
          question: "How do users access the product?",
          answer:
            "Access continues through the existing registration, login, dashboard, and invite-based student workflows.",
        },
      ]}
    />
  );
}
