import "server-only";

import { d1Query } from "@/lib/d1";
import type {
  CompareResponse,
  ComparisonExplanation,
  ComparisonIntent,
  ComparisonSeries,
  FilterSummary,
} from "@/lib/types";

type DbSession = {
  id: string;
  user_id: string;
  title: string | null;
  keywords: string | null;
  date_from: string | null;
  date_to: string | null;
  benchmark: string | null;
  include_top: number | null;
  use_filter: number | null;
  filter_terms: string | null;
  filter_prompt: string | null;
  filter_summary: string | null;
  created_at: string | null;
};

type DbCandidate = {
  id: string;
  session_id: string;
  user_id: string;
  keyword: string;
  value: number | null;
  type: string | null;
  source: string | null;
  filtered: number | null;
  created_at: string | null;
};

type DbComparison = {
  id: string;
  session_id: string;
  user_id: string;
  benchmark: string | null;
  date_from: string | null;
  date_to: string | null;
  summary: string | null;
  recent_points: number | null;
  metrics_version: string | null;
  created_at: string | null;
};

type DbComparisonResult = {
  id: string;
  comparison_id: string;
  user_id: string;
  keyword: string;
  avg_value: number | null;
  benchmark_value: number | null;
  ratio: number | null;
  ratio_mean: number | null;
  ratio_recent: number | null;
  ratio_coverage: number | null;
  ratio_peak: number | null;
  slope_diff: number | null;
  volatility: number | null;
  crossings: number | null;
  verdict: string | null;
  trend_series: string | null;
  explanation: string | null;
  intent: string | null;
  created_at: string | null;
};

type ComparisonSummary = CompareResponse["summary"];

export type SessionPayload = {
  session: {
    id: string;
    user_id: string;
    title: string | null;
    keywords: string[];
    date_from: string | null;
    date_to: string | null;
    benchmark: string | null;
    include_top: boolean;
    use_filter: boolean;
    filter_terms: string[];
    filter_prompt: string | null;
    filter_summary: FilterSummary | null;
    created_at: string | null;
  } | null;
  candidates: Array<{
    id: string;
    session_id: string;
    user_id: string;
    keyword: string;
    value: number | null;
    type: "top" | "rising" | null;
    source: string | null;
    filtered: boolean;
    created_at: string | null;
  }>;
  comparison: {
    id: string;
    session_id: string;
    user_id: string;
    benchmark: string | null;
    date_from: string | null;
    date_to: string | null;
    summary: ComparisonSummary | null;
    recent_points: number | null;
    metrics_version: string | null;
    created_at: string | null;
  } | null;
  comparisonResults: Array<{
    id: string;
    comparison_id: string;
    user_id: string;
    keyword: string;
    avg_value: number | null;
    benchmark_value: number | null;
    ratio: number | null;
    ratio_mean: number | null;
    ratio_recent: number | null;
    ratio_coverage: number | null;
    ratio_peak: number | null;
    slope_diff: number | null;
    volatility: number | null;
    crossings: number | null;
    verdict: string | null;
    trend_series: ComparisonSeries | null;
    explanation: ComparisonExplanation | null;
    intent: ComparisonIntent | null;
    created_at: string | null;
  }>;
};

export type SessionSummary = {
  id: string;
  title: string | null;
  keywords: string[];
  date_from: string | null;
  date_to: string | null;
  benchmark: string | null;
  created_at: string | null;
};

const parseJson = <T,>(value: string | null): T | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const parseJsonArray = <T,>(value: string | null): T[] => {
  const parsed = parseJson<T[]>(value);
  return Array.isArray(parsed) ? parsed : [];
};

const toBool = (value: number | null) => Boolean(value);

export const fetchSessionPayload = async (
  userId: string,
  sessionId?: string
): Promise<SessionPayload | null> => {
  const sessionQuery = sessionId
    ? {
        sql: "SELECT * FROM research_sessions WHERE id = ? AND user_id = ? LIMIT 1",
        params: [sessionId, userId],
      }
    : {
        sql: "SELECT * FROM research_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
        params: [userId],
      };

  const { rows: sessionRows } = await d1Query<DbSession>(
    sessionQuery.sql,
    sessionQuery.params
  );

  const sessionRow = sessionRows[0];
  if (!sessionRow) return null;

  const session = {
    ...sessionRow,
    keywords: parseJsonArray<string>(sessionRow.keywords),
    include_top: toBool(sessionRow.include_top),
    use_filter: toBool(sessionRow.use_filter),
    filter_terms: parseJsonArray<string>(sessionRow.filter_terms),
    filter_summary: parseJson<FilterSummary>(sessionRow.filter_summary),
  };

  const { rows: candidateRows } = await d1Query<DbCandidate>(
    "SELECT * FROM candidates WHERE session_id = ?",
    [sessionRow.id]
  );

  const candidates: SessionPayload["candidates"] = candidateRows.map((row) => ({
    id: row.id,
    session_id: row.session_id,
    user_id: row.user_id,
    keyword: row.keyword,
    value: row.value,
    type: row.type === "top" || row.type === "rising" ? row.type : null,
    source: row.source,
    filtered: toBool(row.filtered),
    created_at: row.created_at,
  }));

  const { rows: comparisonRows } = await d1Query<DbComparison>(
    "SELECT * FROM comparisons WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
    [sessionRow.id]
  );

  const comparisonRow = comparisonRows[0];
  const comparison = comparisonRow
    ? {
        ...comparisonRow,
        summary: parseJson<ComparisonSummary>(comparisonRow.summary),
      }
    : null;

  let comparisonResults: SessionPayload["comparisonResults"] = [];

  if (comparisonRow) {
    const { rows: results } = await d1Query<DbComparisonResult>(
      "SELECT * FROM comparison_results WHERE comparison_id = ?",
      [comparisonRow.id]
    );

    comparisonResults = results.map((row) => ({
      ...row,
      trend_series: parseJson<ComparisonSeries>(row.trend_series),
      explanation: parseJson<ComparisonExplanation>(row.explanation),
      intent: parseJson<ComparisonIntent>(row.intent),
    }));
  }

  return {
    session,
    candidates,
    comparison,
    comparisonResults,
  };
};

export const listSessions = async (
  userId: string,
  limit = 20
): Promise<SessionSummary[]> => {
  const { rows } = await d1Query<DbSession>(
    "SELECT id, title, keywords, date_from, date_to, benchmark, created_at FROM research_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    [userId, limit]
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    keywords: parseJsonArray<string>(row.keywords),
    date_from: row.date_from,
    date_to: row.date_to,
    benchmark: row.benchmark,
    created_at: row.created_at,
  }));
};
