export type CandidateType = "top" | "rising";

export type AuthUser = {
  id: string;
  email: string;
};

export type ComparisonVerdict =
  | "strong"
  | "pass"
  | "close"
  | "watch"
  | "fail";

export type ComparisonFreshnessStatus =
  | "new"
  | "old_hot"
  | "stable_old"
  | "unclear";

export type ComparisonFreshness = {
  status: ComparisonFreshnessStatus;
  label: string;
  window: "7d" | "30d" | "90d" | "none";
  score: number;
  reason: string;
};

export type DecayRisk = "low" | "medium" | "high";

export type Candidate = {
  keyword: string;
  value: number;
  type: CandidateType;
  source: string;
  isNew?: boolean;
  score?: number;
  confidence?: number;
  freshness?: ComparisonFreshness;
  decayRisk?: DecayRisk;
};

export type OrganizedCandidates = {
  explosive: Candidate[];
  fastRising: Candidate[];
  steadyRising: Candidate[];
  slowRising: Candidate[];
};

export type ComparisonSeries = {
  timestamps: string[];
  values: number[];
  benchmarkValues: number[];
};

export type ComparisonExplanation = {
  summary: string;
  reasons: string[];
  metrics: {
    isNew?: boolean;
    baselineMean: number;
    baselinePeak: number;
    recentMean: number;
    recentPeak: number;
    ratioMean: number;
    ratioRecent: number;
    ratioCoverage: number;
    ratioPeak: number;
    ratioLastPoint?: number;
    endStreak: number;
    endVsPeak: number;
    volatility: number;
    slopeRatio?: number;
    slopeDiff: number;
  };
};

export type ComparisonIntent = {
  label: string;
  demand: string;
  reason: string;
  confidence?: number;
};

export type ComparisonResult = {
  keyword: string;
  avgValue: number;
  benchmarkValue: number;
  ratio: number;
  ratioMean: number;
  ratioRecent: number;
  ratioCoverage: number;
  ratioPeak: number;
  ratioLastPoint?: number;
  slopeDiff: number;
  slopeRatio?: number;
  volatility: number;
  crossings: number;
  verdict: ComparisonVerdict;
  series?: ComparisonSeries;
  explanation?: ComparisonExplanation;
  intent?: ComparisonIntent;
  freshness?: ComparisonFreshness;
  decayRisk?: DecayRisk;
};

export type FilterSummary = {
  enabled: boolean;
  model?: string;
  total: number;
  removed: number;
  kept: number;
  skippedReason?: string;
};

export type ExpandResponse = {
  keywords: string[];
  dateFrom: string;
  dateTo: string;
  candidates: Candidate[];
  organized: OrganizedCandidates;
  flatList: Candidate[];
  fromCache: boolean;
  filter?: FilterSummary;
  filteredOut?: Candidate[];
  sessionId?: string;
  ruleStats?: { blocked: number; kept: number };
  gameKeywords?: Array<{
    keyword: string;
    source: string;
    ratio: number;
    slope: number;
    verdict: string;
    checkedAt: string;
    isGame: true;
  }>;
  trendsSummary?: {
    benchmark: string;
    totalCompared: number;
    keywords: Record<string, {
      ratio: number;
      ratioMean: number;
      ratioRecent: number;
      slopeRatio?: number;
      volatility: number;
      verdict: string;
    }>;
  };
};

export type CompareResponse = {
  benchmark: string;
  dateFrom: string;
  dateTo: string;
  results: ComparisonResult[];
  summary: {
    strong: number;
    pass: number;
    close: number;
    watch: number;
    fail: number;
  };
  comparisonId?: string;
  sessionId?: string;
};

export type ComparisonSignalConfig = {
  avgRatioMin: number;
  lastPointRatioMin: number;
  peakRatioMin: number;
  slopeRatioMinStrong: number;
  slopeRatioMinPass: number;
  risingStrongMinSlopeRatio: number;
  risingStrongMinTailRatio: number;
  nearOneTolerance: number;
};
