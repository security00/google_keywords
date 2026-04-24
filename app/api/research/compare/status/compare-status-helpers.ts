import type { CompareResponse, ComparisonSignalConfig } from "@/lib/types";
import { d1Query } from "@/lib/d1";

export const METRICS_VERSION = "v1";
export const DEFAULT_COMPARISON_SIGNAL_CONFIG: ComparisonSignalConfig = {
  avgRatioMin: 1,
  lastPointRatioMin: 1,
  peakRatioMin: 1.2,
  slopeRatioMinStrong: 1.35,
  slopeRatioMinPass: 0.9,
  risingStrongMinSlopeRatio: 1.35,
  risingStrongMinTailRatio: 1,
  nearOneTolerance: 0.1,
};
export const COMPARISON_SIGNAL_CONFIG_RANGES: Record<
  keyof ComparisonSignalConfig,
  [number, number]
> = {
  avgRatioMin: [0.2, 10],
  lastPointRatioMin: [0.2, 10],
  peakRatioMin: [0.2, 10],
  slopeRatioMinStrong: [0.5, 20],
  slopeRatioMinPass: [0.2, 20],
  risingStrongMinSlopeRatio: [0.5, 20],
  risingStrongMinTailRatio: [0.2, 10],
  nearOneTolerance: [0.01, 0.5],
};
export const D1_IN_QUERY_CHUNK_SIZE = 100;
export const PROCESSING_STALE_MS = 2 * 60 * 1000;

export const safeJsonParse = <T,>(value: string | null) => {
  if (!value) return undefined as T | undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined as T | undefined;
  }
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const shouldRetryD1 = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("network connection lost") ||
    lowered.includes("exceeded timeout") ||
    lowered.includes("timeout") ||
    lowered.includes("exceeded its memory limit") ||
    lowered.includes("storage operation") ||
    lowered.includes("internal error") ||
    lowered.includes("too many requests queued") ||
    lowered.includes("d1_error") ||
    lowered.includes("error code: 1031") ||
    /d1 request failed \((429|500|502|503|504|520|522|524)\)/.test(lowered)
  );
};

export const parseComparisonSignalConfig = (
  raw: unknown
): Partial<ComparisonSignalConfig> => {
  const input =
    raw && typeof raw === "object"
      ? (raw as Partial<Record<string, unknown>>)
      : undefined;

  const parseValue = (key: keyof ComparisonSignalConfig) => {
    const value = input?.[key];
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_COMPARISON_SIGNAL_CONFIG[key];
    }
    const [min, max] = COMPARISON_SIGNAL_CONFIG_RANGES[key];
    return Math.min(max, Math.max(min, parsed));
  };

  return {
    avgRatioMin: parseValue("avgRatioMin"),
    lastPointRatioMin: parseValue("lastPointRatioMin"),
    peakRatioMin: parseValue("peakRatioMin"),
    slopeRatioMinStrong: parseValue("slopeRatioMinStrong"),
    slopeRatioMinPass: parseValue("slopeRatioMinPass"),
    risingStrongMinSlopeRatio: parseValue("risingStrongMinSlopeRatio"),
    risingStrongMinTailRatio: parseValue("risingStrongMinTailRatio"),
    nearOneTolerance: parseValue("nearOneTolerance"),
  };
};

export const loadPostbackResults = async (taskIds: string[]) => {
  const rows: { task_id: string; result_data: string }[] = [];

  for (let index = 0; index < taskIds.length; index += D1_IN_QUERY_CHUNK_SIZE) {
    const chunk = taskIds.slice(index, index + D1_IN_QUERY_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await d1Query<{ task_id: string; result_data: string }>(
      `SELECT task_id, result_data
       FROM postback_results
       WHERE task_id IN (${placeholders})`,
      chunk
    );
    rows.push(...result.rows);
  }

  return rows;
};
