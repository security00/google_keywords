import type { Metadata } from "next";
import { MarketingPage } from "@/components/marketing-page";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Game Keyword Research | Discover Keywords",
  description:
    "Find reviewed game keyword opportunities with game relevance checks, trend validation, SERP-fit screening, and guarded research workflows.",
  alternates: {
    canonical: "https://discoverkeywords.co/game-keyword-research",
  },
};

export default function GameKeywordResearchPage() {
  return (
    <MarketingPage
      eyebrow="Game keyword research"
      title="Find new game keyword opportunities without turning every game mention into a target."
      description="Discover Keywords helps game-site operators separate useful game demand from noisy launches, fandom spikes, and weak-fit scraped titles."
      benefits={[
        "Screen new game signals before they become student-facing recommendations.",
        "Require game relevance and SERP-fit evidence before prioritizing game pages.",
        "Keep Trends, SERP, and enrichment work behind protected workflows instead of public pages.",
      ]}
      workflow={[
        {
          title: "Watch game sources",
          text: "Track curated game feeds, source quality signals, and reviewed opportunity data without restoring noisy legacy sitemap discovery as the main source.",
        },
        {
          title: "Reject weak-fit titles",
          text: "Filter non-game noise, thin scraped candidates, and terms that do not support a useful game page or guide.",
        },
        {
          title: "Validate game intent",
          text: "Require trend and SERP evidence so missing provider data does not become a false low-competition recommendation.",
        },
        {
          title: "Prioritize buildable pages",
          text: "Route approved game opportunities toward protected reports, admin review, and operator decisions before production work.",
        },
      ]}
      proof={[
        {
          label: "Game radar",
          title: "Source quality before scale",
          text: "Use source score, review history, and relevance checks before expanding a game keyword cluster.",
        },
        {
          label: "Fail closed",
          title: "No default approval on missing SERP",
          text: "When SERP or trend evidence is missing, the workflow does not treat the term as a confirmed opportunity.",
        },
        {
          label: "Protected workflow",
          title: "Admin-only enrichment stays gated",
          text: "Game radar, opportunity reports, and enrichment tools remain controlled behind the dashboard.",
        },
      ]}
      faqs={[
        {
          question: "Does this page run game discovery?",
          answer:
            "No. This is a static SEO page. Game discovery, enrichment, and validation continue inside protected admin and background workflows.",
        },
        {
          question: "Why not publish every new game keyword?",
          answer:
            "Many game mentions are short-lived, duplicate, or weak-fit. Reviewed relevance and SERP evidence prevent thin pages and wasted production work.",
        },
        {
          question: "What happens when SERP data fails?",
          answer:
            "The game recommendation path fails closed instead of assuming low competition or confirmed relevance.",
        },
        {
          question: "Can students trigger paid game checks here?",
          answer:
            "No. Public pages do not call paid providers. Student workflows stay on shared cache and guarded research endpoints.",
        },
        {
          question: "How do you validate game keywords before building pages?",
          answer:
            "Game candidates need relevance checks, trend evidence, SERP fit, and review context before they become buildable opportunities.",
        },
        {
          question: "What game keyword signals are risky?",
          answer:
            "Duplicate scraped titles, short-lived launch spikes, fandom-only phrases, non-game terms, and missing SERP evidence are risky and should not be treated as confirmed opportunities.",
        },
      ]}
    />
  );
}
