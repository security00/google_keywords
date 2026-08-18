import {
  BadgeCheck,
  BarChart3,
  Code2,
  FileText,
  Layers3,
  Radar,
  SearchCheck,
  ShieldCheck,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

export const heroStats = [
  { value: "5+", label: "Signal sources" },
  { value: "3", label: "Review stages" },
  { value: "90d", label: "Trend evidence" },
  { value: "Weekly", label: "Fresh opportunities" },
];

export type HomeFeatureVisual = "chips" | "review" | "score" | "brief" | "api" | "billing";

export type HomeFeature = {
  title: string;
  text: string;
  icon: LucideIcon;
  span: "wide" | "normal";
  visual: HomeFeatureVisual;
};

export const productFeatures: HomeFeature[] = [
  {
    title: "Signal discovery",
    text: "Fresh product launches, community threads, game releases, and niche RSS feeds are captured before they turn into crowded keywords.",
    icon: Radar,
    span: "wide",
    visual: "chips",
  },
  {
    title: "Human-safe review",
    text: "Noise, trademark risk, celebrity spikes, and short-lived news are filtered out before a keyword ever reaches your queue.",
    icon: ShieldCheck,
    span: "normal",
    visual: "review",
  },
  {
    title: "SERP-aware scoring",
    text: "Trend movement, search intent, SERP shape, CPC, and difficulty blend into one practical buildability score.",
    icon: SearchCheck,
    span: "normal",
    visual: "score",
  },
  {
    title: "Build Briefs",
    text: "Turn a strong keyword into an MVP direction — audience, angle, page outline, and first moves, ready to build from.",
    icon: FileText,
    span: "wide",
    visual: "brief",
  },
  {
    title: "API access",
    text: "Pull reviewed opportunities, scores, and evidence into your own tools and pipelines with a documented API.",
    icon: Code2,
    span: "normal",
    visual: "api",
  },
  {
    title: "Flat-rate peace of mind",
    text: "One flat founding price covers the radar, the database, and your briefs. No per-query meters, no credit math, no surprise invoices.",
    icon: BadgeCheck,
    span: "wide",
    visual: "billing",
  },
];

export const workflowSteps = [
  {
    label: "01",
    title: "Collect",
    text: "New signals flow in from product launches, communities, game releases, and niche RSS feeds.",
  },
  {
    label: "02",
    title: "Review",
    text: "Each candidate is screened for noise, intent quality, and real buildable search demand.",
  },
  {
    label: "03",
    title: "Validate",
    text: "Trend movement, SERP shape, and supporting evidence are checked before an opportunity is promoted.",
  },
  {
    label: "04",
    title: "Act",
    text: "Approved opportunities become build briefs, watchlists, and page clusters you can ship.",
  },
];

export type HomeUseCase = {
  title: string;
  text: string;
  href: string;
  icon: LucideIcon;
};

export const useCases: HomeUseCase[] = [
  {
    title: "Tool-site operators",
    text: "Find generator, calculator, template, and workflow keywords before they feel crowded.",
    href: "/keyword-opportunity-platform",
    icon: Zap,
  },
  {
    title: "SEO teams",
    text: "Turn noisy multi-source demand into reviewed keyword candidates with clear evidence.",
    href: "/seo-signal-discovery",
    icon: Layers3,
  },
  {
    title: "Programmatic SEO",
    text: "Prioritize repeatable page patterns from live demand shape instead of static exports.",
    href: "/programmatic-seo-keyword-research",
    icon: Workflow,
  },
  {
    title: "Game keyword research",
    text: "Screen game opportunities with relevance, trend checks, and SERP-fit review.",
    href: "/game-keyword-research",
    icon: BarChart3,
  },
];

export const solutionPages = [
  {
    title: "Opportunity platform",
    href: "/keyword-opportunity-platform",
    text: "Reviewed signals become buildable keyword opportunities.",
  },
  {
    title: "Signal discovery",
    href: "/seo-signal-discovery",
    text: "Collection, filtering, review, and validation in one workflow.",
  },
  {
    title: "Programmatic SEO",
    href: "/programmatic-seo-keyword-research",
    text: "Repeatable page patterns for tools, templates, games, and clusters.",
  },
  {
    title: "Game keywords",
    href: "/game-keyword-research",
    text: "Safer game opportunities with relevance and SERP validation.",
  },
  {
    title: "AI keywords",
    href: "/ai-keyword-research",
    text: "AI product, agent, and workflow signals filtered before research.",
  },
  {
    title: "API docs",
    href: "/api-docs",
    text: "Documented endpoints for pulling reviewed opportunities into your own tools.",
  },
];

// DEMO DATA — placeholder numbers for layout review. Replace with real case data before launch.
export type CaseStudy = {
  keyword: string;
  score: number;
  foundDate: string;
  siteName: string;
  siteUrl: string;
  description: string;
  chart: "steady" | "hockey" | "early";
  metrics: Array<{ label: string; value: string }>;
};

export const caseStudies: CaseStudy[] = [
  {
    keyword: "mayan astrology calculator",
    score: 84,
    foundDate: "Nov 2025",
    siteName: "Mayan Astrology Calculator",
    siteUrl: "mayanastro.app",
    description: "Personalized Mayan sign readings with paid in-depth reports.",
    chart: "steady",
    metrics: [
      { label: "Monthly visits", value: "12.4K" },
      { label: "Monthly revenue", value: "$1,180" },
      { label: "Target keyword", value: "#1" },
    ],
  },
  {
    keyword: "ai headshot generator",
    score: 82,
    foundDate: "May 2026",
    siteName: "AI Headshot Studio",
    siteUrl: "headshotstudio.tools",
    description: "Turn selfies into professional headshots with one credit pack.",
    chart: "hockey",
    metrics: [
      { label: "Monthly visits", value: "8.2K" },
      { label: "Monthly revenue", value: "$430" },
      { label: "Time live", value: "3 mo" },
    ],
  },
  {
    keyword: "podcast name generator",
    score: 78,
    foundDate: "Jul 2026",
    siteName: "Podcast Name Lab",
    siteUrl: "podcastnamelab.com",
    description: "Free name generator with category-based ideas and availability checks.",
    chart: "early",
    metrics: [
      { label: "Monthly visits", value: "2.9K" },
      { label: "Revenue", value: "Pre-launch" },
      { label: "Time live", value: "5 wks" },
    ],
  },
];

export const homeFaqs = [
  {
    question: "How is Discover Keywords different from a normal keyword tool?",
    answer:
      "Traditional keyword tools help you look up terms you already know. Discover Keywords watches product launches, communities, and search behavior for you, then promotes only the signals that pass trend, intent, and SERP review — so you see opportunities before they become crowded.",
  },
  {
    question: "Where do the opportunities come from?",
    answer:
      "Signals are collected from product launches, community discussions, game releases, RSS feeds, and operator research. Every candidate is screened, scored, and reviewed before it appears in your Opportunity Radar.",
  },
  {
    question: "What do I get with the Founding Member plan?",
    answer:
      "Full access to the Opportunity Radar, the private opportunity database, trend and SERP evidence for every keyword, and 20 Build Brief credits per month to turn a strong keyword into an MVP direction.",
  },
  {
    question: "Do I need deep SEO experience to use it?",
    answer:
      "No. Every opportunity arrives with a plain-language buildability score and the evidence behind it, so you can make a confident build decision without living inside SEO tooling.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Subscriptions are managed through a self-serve billing portal, and you can cancel whenever you like. Your access stays active until the end of the current billing period.",
  },
  {
    question: "Who is Discover Keywords for?",
    answer:
      "Indie hackers, tool-site operators, SEO teams, and programmatic builders who want reviewed demand signals to decide what to build next.",
  },
];
