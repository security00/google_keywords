import { NextResponse } from "next/server";

import type { ComparisonVerdict } from "@/lib/types";
import { d1Query } from "@/lib/d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type KeywordRow = {
  id: string;
  keyword: string;
  status: string;
  url: string | null;
  extracted_at: string;
  source_name: string | null;
  sitemap_url: string;
};

type ComparisonSummary = {
  id: string;
  benchmark: string | null;
  date_from: string | null;
  date_to: string | null;
  summary: string | null;
  created_at: string;
};

type ComparisonResultRow = {
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

const DEFAULT_KEYWORDS_LIMIT = 200;
const DEFAULT_RESULT_LIMIT = 300;
const DEFAULT_COMPARISON_SESSIONS = 3;
const DEFAULT_VERDICTS: ComparisonVerdict[] = ["strong", "pass", "close", "watch"];

const parseDateParam = (value: string | null) => {
  if (!value) return undefined;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts).toISOString();
};

const parseIntParam = (
  raw: string | null,
  fallback: number,
  min: number,
  max: number
) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const safeJsonParse = <T,>(value: string | null) => {
  if (!value) return undefined as T | undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined as T | undefined;
  }
};

const parseVerdictList = (raw: string | null): ComparisonVerdict[] => {
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

const getComparisonResultColumns = async () => {
  const { rows } = await d1Query<ColumnInfo>("PRAGMA table_info(comparison_results)");
  return new Set(rows.map((row) => row.name));
};

const normalizeReason = (status: string, verdict: string | null) => {
  if (verdict) return verdict;
  if (status === "new") return "new";
  if (status === "compared") return "compared";
  if (status === "ignored") return "ignored";
  return status || "new";
};

const isAuthorized = (request: Request) => {
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

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const keywordStatus = url.searchParams.get("status") ?? "new";
    const includeComparison = url.searchParams.get("includeComparison") !== "0";
    const includeFailedComparison = url.searchParams.get("includeFailedComparison") === "1";
    const sinceRaw = parseDateParam(url.searchParams.get("since"));
    const sinceClause = sinceRaw ? "AND dk.extracted_at >= ?" : "";
    const comparisonSinceRaw = parseDateParam(url.searchParams.get("comparisonSince"));
    const comparisonSinceClause = comparisonSinceRaw ? "AND created_at >= ?" : "";
    const compactMode = url.searchParams.get("compact") !== "0";

    const keywordLimit = parseIntParam(url.searchParams.get("keywordsLimit"), DEFAULT_KEYWORDS_LIMIT, 1, 1000);
    const comparisonResultLimit = parseIntParam(
      url.searchParams.get("resultLimit"),
      DEFAULT_RESULT_LIMIT,
      1,
      3000
    );
    const comparisonSessions = parseIntParam(
      url.searchParams.get("comparisonSessions"),
      DEFAULT_COMPARISON_SESSIONS,
      1,
      20
    );
    const verdicts = parseVerdictList(url.searchParams.get("verdicts"));
    const includeComparisonVerdicts = verdicts.filter((verdict) => includeFailedComparison || verdict !== "fail");

    const keywordWhere = keywordStatus === "all"
      ? ["dk.user_id = ?"]
      : ["dk.user_id = ?", "dk.status = ?"];
    const keywordRowsParams: unknown[] = [userId, ...(keywordStatus === "all" ? [] : [keywordStatus])];
    if (sinceRaw) keywordRowsParams.push(sinceRaw);

    const keywordWhereSql = `WHERE ${keywordWhere.join(" AND ")} ${sinceClause}`;

    const { rows: keywordRows } = await d1Query<KeywordRow>(
      `SELECT dk.id, dk.keyword, dk.status, dk.url, dk.extracted_at, s.name AS source_name, s.sitemap_url
       FROM discovered_keywords dk
       JOIN sitemap_sources s ON s.id = dk.source_id
       ${keywordWhereSql}
       ORDER BY dk.extracted_at DESC
       LIMIT ?`,
      [...keywordRowsParams, keywordLimit]
    );

    let comparisonSessionsRows: ComparisonSummary[] = [];
    let comparisonResultRows: ComparisonResultRow[] = [];

    if (includeComparison) {
      const comparisonParams: unknown[] = [userId];
      if (comparisonSinceRaw) comparisonParams.push(comparisonSinceRaw);
      comparisonParams.push(comparisonSessions);

      const { rows: sessions } = await d1Query<ComparisonSummary>(
        `SELECT id, benchmark, date_from, date_to, summary, created_at
         FROM comparisons
         WHERE user_id = ? ${comparisonSinceClause}
         ORDER BY created_at DESC
         LIMIT ?`,
        comparisonParams
      );
      comparisonSessionsRows = sessions;

      if (sessions.length > 0) {
        const ids = sessions.map((item) => item.id);
        const placeholders = ids.map(() => "?").join(",");
        const columns = await getComparisonResultColumns();
        const selectedColumns = [
          "comparison_id",
          "keyword",
          "avg_value",
          "benchmark_value",
          "ratio",
          "ratio_mean",
          "ratio_recent",
          "ratio_peak",
          "slope_diff",
          "volatility",
          "crossings",
          "verdict",
        ];
        if (columns.has("ratio_last_point")) {
          selectedColumns.push("ratio_last_point");
        }
        if (columns.has("slope_ratio")) {
          selectedColumns.push("slope_ratio");
        }
        const { rows: results } = await d1Query<ComparisonResultRow>(
          `SELECT ${selectedColumns.join(", ")}
           FROM comparison_results
           WHERE comparison_id IN (${placeholders})
           ORDER BY comparison_id DESC, ratio DESC
           LIMIT ?`,
          [...ids, comparisonResultLimit]
        );
        comparisonResultRows = results;
      }
    }

    const filteredComparisonResults = comparisonResultRows.filter((row) => {
      const verdict = row.verdict as ComparisonVerdict | undefined;
      return includeComparisonVerdicts.includes(verdict as ComparisonVerdict);
    });

    if (compactMode) {
      const reasonByKeyword = new Map<string, string>();
      for (const row of filteredComparisonResults) {
        const key = row.keyword.trim().toLowerCase();
        if (!reasonByKeyword.has(key) && row.verdict) {
          reasonByKeyword.set(key, row.verdict);
        }
      }

      const items: Array<{ keyword: string; reason: string }> = [];
      const seenKeywords = new Set<string>();
      for (const row of keywordRows) {
        const keyword = row.keyword.trim();
        const key = keyword.toLowerCase();
        if (seenKeywords.has(key)) continue;
        seenKeywords.add(key);
        items.push({
          keyword,
          reason: reasonByKeyword.get(key) ?? normalizeReason(row.status, null),
        });
      }

      return NextResponse.json({
        generatedAt: new Date().toISOString(),
        userId,
        items,
      });
    }

    const comparisonPayload = comparisonSessionsRows.map((session) => ({
      id: session.id,
      benchmark: session.benchmark ?? "gpts",
      dateFrom: session.date_from ?? "",
      dateTo: session.date_to ?? "",
      createdAt: session.created_at,
      summary: safeJsonParse<{
        strong: number;
        pass: number;
        close: number;
        watch: number;
        fail: number;
      }>(session.summary) ?? { strong: 0, pass: 0, close: 0, watch: 0, fail: 0 },
    }));

    const comparisonResultsBySession = new Map<string, ComparisonResultRow[]>();
    for (const row of filteredComparisonResults) {
      const bucket = comparisonResultsBySession.get(row.comparison_id) ?? [];
      bucket.push(row);
      comparisonResultsBySession.set(row.comparison_id, bucket);
    }

    const comparisonResults = comparisonPayload.map((session) => ({
      ...session,
      items: (comparisonResultsBySession.get(session.id) ?? []).map((row) => ({
        keyword: row.keyword,
        avgValue: Number(row.avg_value ?? 0),
        benchmarkValue: Number(row.benchmark_value ?? 0),
        ratio: Number(row.ratio ?? 0),
        ratioMean: Number(row.ratio_mean ?? 0),
        ratioRecent: Number(row.ratio_recent ?? 0),
        ratioPeak: Number(row.ratio_peak ?? 0),
        slopeDiff: Number(row.slope_diff ?? 0),
        volatility: Number(row.volatility ?? 0),
        crossings: Number(row.crossings ?? 0),
        ratioLastPoint: Number(row.ratio_last_point ?? 0),
        slopeRatio: row.slope_ratio ?? undefined,
        verdict: row.verdict,
      })),
    }));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      userId,
      filters: {
        keywordStatus,
        since: sinceRaw ?? null,
        includeComparison,
        includeFailedComparison,
        comparisonSince: comparisonSinceRaw ?? null,
        verdicts: includeComparisonVerdicts,
        comparisonSessions,
        keywordLimit,
        comparisonResultLimit,
      },
      discoveredKeywords: keywordRows.map((row) => ({
        id: row.id,
        keyword: row.keyword,
        status: row.status,
        url: row.url,
        extractedAt: row.extracted_at,
        sourceName: row.source_name,
        sitemapUrl: row.sitemap_url,
      })),
      comparisonResults,
      totals: {
        discoveredKeywords: keywordRows.length,
        comparisonSessions: comparisonPayload.length,
        comparisonItems: filteredComparisonResults.length,
      },
    });
  } catch (error) {
    console.error("[integrations/discovery-feed]", error);
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
