import type { ComparisonVerdict } from "@/lib/types";
import { d1Query } from "@/lib/d1";

export type KeywordRow = {
  id: string;
  keyword: string;
  status: string;
  url: string | null;
  extracted_at: string;
  source_name: string | null;
  sitemap_url: string;
};

export type ComparisonSummary = {
  id: string;
  benchmark: string | null;
  date_from: string | null;
  date_to: string | null;
  summary: string | null;
  created_at: string;
};

export type ComparisonResultRow = {
  comparison_id: string;
  keyword: string;
  avg_value: number | null;
  benchmark_value: number | null;
  ratio: number | null;
  ratio_mean: number | null;
  ratio_recent: number | null;
  ratio_peak: number | null;
  slope_diff: number | null;
  volatility: number | null;
  crossings: number | null;
  verdict: string | null;
  ratio_last_point: number | null;
  slope_ratio: number | null;
};

export const DEFAULT_KEYWORDS_LIMIT = 200;
export const DEFAULT_RESULT_LIMIT = 300;
export const DEFAULT_COMPARISON_SESSIONS = 3;
export const DEFAULT_VERDICTS: ComparisonVerdict[] = ["strong", "pass", "close", "watch"];

export const parseDateParam = (value: string | null) => {
  if (!value) return undefined;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts).toISOString();
};

export const parseIntParam = (
  raw: string | null,
  fallback: number,
  min: number,
  max: number
) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

export const safeJsonParse = <T,>(value: string | null) => {
  if (!value) return undefined as T | undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined as T | undefined;
  }
};

export const parseVerdictList = (raw: string | null): ComparisonVerdict[] => {
  if (!raw) return [...DEFAULT_VERDICTS];
  const candidates = raw.split(",").map((item) => item.trim().toLowerCase());
  const values = new Set<ComparisonVerdict>();
  for (const candidate of candidates) {
    if (
      candidate === "strong" ||
      candidate === "pass" ||
      candidate === "close" ||
      candidate === "watch" ||
      candidate === "fail"
    ) {
      values.add(candidate);
    }
  }
  return values.size > 0 ? Array.from(values) : [...DEFAULT_VERDICTS];
};

type ColumnInfo = {
  name: string;
};

export const getComparisonResultColumns = async () => {
  const { rows } = await d1Query<ColumnInfo>("PRAGMA table_info(comparison_results)");
  return new Set(rows.map((row) => row.name));
};

export const normalizeReason = (status: string, verdict: string | null) => {
  if (verdict) return verdict;
  if (status === "new") return "new";
  if (status === "compared") return "compared";
  if (status === "ignored") return "ignored";
  return status || "new";
};

export const isAuthorized = (request: Request) => {
  const token = process.env.DISCOVERY_PARTNER_TOKEN;
  if (!token) return false;

  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : authorization;
  if (bearer && bearer === token) return true;

  const xToken = request.headers.get("x-partner-token");
  return !!xToken && xToken === token;
};
