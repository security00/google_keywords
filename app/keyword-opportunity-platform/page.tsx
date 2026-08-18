import { MarketingPage } from "@/components/marketing-page";
import { marketingPageMetadata } from "@/lib/marketing-metadata";

export const dynamic = "force-static";

export const metadata = marketingPageMetadata({
  title: "Keyword Opportunity Platform | Discover Keywords",
  description:
    "Find low-competition keyword opportunities from reviewed signals, trend checks, and SERP validation before they crowd traditional databases.",
  path: "/keyword-opportunity-platform",
});

export default function KeywordOpportunityPlatformPage() {
  return (
    <MarketingPage
      eyebrow="Keyword opportunity platform"
      title="Find low-competition keyword opportunities before they crowd traditional databases."
      description="Discover Keywords is built for operators who need early, reviewed, and buildable opportunities instead of another spreadsheet of already-crowded keywords."
      benefits={[
        "Track demand signals before they settle into crowded keyword tools.",
        "Filter entertainment, news, brand, and short-lived noise before research spend.",
        "Keep your research, shortlists, and working dashboard private to your membership.",
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
          title: "Reviewed results you can reuse",
          text: "Students and operators start from already-reviewed research, so exploring new angles stays fast and never wastes research budget.",
        },
      ]}
      faqs={[
        {
          question: "Is this a replacement for keyword lookup tools?",
          answer:
            "No. It focuses on opportunity discovery before a term becomes widely visible, then uses validation gates before recommending action.",
        },
        {
          question: "Is this page connected to the live product?",
          answer:
            "This page explains the workflow. Membership unlocks the working dashboard with live trend checks, SERP validation, and the full opportunity database.",
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
        {
          question: "How do you find low-competition keyword opportunities?",
          answer:
            "The workflow starts with early signals, then checks intent, trend movement, SERP shape, and buildability before an opportunity is treated as worth action.",
        },
        {
          question: "What makes a keyword opportunity buildable?",
          answer:
            "A buildable opportunity has a clear page type, durable intent, enough demand evidence, and a realistic path to a useful tool, guide, template, or database page.",
        },
      ]}
    />
  );
}
