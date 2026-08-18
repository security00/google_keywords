import { MarketingPage } from "@/components/marketing-page";
import { marketingPageMetadata } from "@/lib/marketing-metadata";

export const dynamic = "force-static";

export const metadata = marketingPageMetadata({
  title: "Game Keyword Research | Discover Keywords",
  description:
    "Find reviewed game keyword opportunities with relevance checks, trend validation, and SERP-fit screening without treating every launch spike as a target.",
  path: "/game-keyword-research",
});

export default function GameKeywordResearchPage() {
  return (
    <MarketingPage
      eyebrow="Game keyword research"
      title="Find new game keyword opportunities without turning every game mention into a target."
      description="Discover Keywords helps game-site operators separate useful game demand from noisy launches, fandom spikes, and weak-fit scraped titles."
      benefits={[
        "Screen new game signals before they become student-facing recommendations.",
        "Require game relevance and SERP-fit evidence before prioritizing game pages.",
        "Get Trends, SERP, and enrichment evidence included with membership instead of stitching tools together.",
      ]}
      workflow={[
        {
          title: "Watch game sources",
          text: "Track curated game feeds, source quality signals, and reviewed opportunity data instead of relying on noisy scraped title lists.",
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
          text: "Route approved game opportunities toward detailed reports, team review, and operator decisions before production work.",
        },
      ]}
      proof={[
        {
          label: "Game radar",
          title: "Source quality before scale",
          text: "Use source score, review history, and relevance checks before expanding a game keyword cluster.",
        },
        {
          label: "Evidence required",
          title: "No evidence, no recommendation",
          text: "When SERP or trend evidence is missing, the term is not treated as a confirmed opportunity.",
        },
        {
          label: "Member workflow",
          title: "Everything in one dashboard",
          text: "Game radar, opportunity reports, and enrichment tools all live in a single member dashboard.",
        },
      ]}
      faqs={[
        {
          question: "Where does game discovery happen?",
          answer:
            "Inside the member dashboard. Game discovery, enrichment, and validation run continuously there, so reviewed opportunities are ready when you log in.",
        },
        {
          question: "Why not publish every new game keyword?",
          answer:
            "Many game mentions are short-lived, duplicate, or weak-fit. Reviewed relevance and SERP evidence prevent thin pages and wasted production work.",
        },
        {
          question: "What if SERP data is unavailable?",
          answer:
            "The term simply is not recommended. Missing evidence never becomes a false low-competition opportunity.",
        },
        {
          question: "Do game checks cost extra for students?",
          answer:
            "No. Trend and SERP checks for game opportunities are part of the member workflow — students explore reviewed results without per-call costs.",
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
