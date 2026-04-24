import { roundTo } from "../dataforseo-client";

/* ── Statistical helpers (used only by compare) ─────────────── */

export const mean = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

export const positiveMean = (values: number[]) => {
  const positiveValues = values.filter((value) => value > 0);
  return mean(positiveValues);
};

export const stdDev = (values: number[]) => {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
};

export const linearSlope = (values: number[]) => {
  if (values.length < 2) return 0;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const x = i - meanX;
    const y = values[i] - meanY;
    numerator += x * y;
    denominator += x * x;
  }
  return denominator === 0 ? 0 : numerator / denominator;
};

export const countCrossings = (a: number[], b: number[]) => {
  let crossings = 0;
  let prevSign = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - (b[i] ?? 0);
    const sign = diff > 0 ? 1 : diff < 0 ? -1 : 0;
    if (sign === 0) continue;
    if (prevSign !== 0 && sign !== prevSign) {
      crossings += 1;
    }
    prevSign = sign;
  }
  return crossings;
};

export const nearOne = (value: number, tolerance = 0.1) =>
  Math.abs(value - 1) <= tolerance;

/* ── Formatting helpers ─────────────────────────────────────── */

export const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
export const formatRatio = (value: number) => `${roundTo(value, 2)}x`;
export const formatNumber = (value: number) => roundTo(value, 2);

/* ── Trend timestamp normalization ──────────────────────────── */

export const normalizeTrendTimestamp = (point: Record<string, unknown>, index: number) => {
  const rawDate =
    (typeof point?.date === "string" && point.date.trim()) ||
    (typeof point?.datetime === "string" && point.datetime.trim()) ||
    (typeof point?.date_time === "string" && point.date_time.trim()) ||
    (typeof point?.time === "string" && point.time.trim()) ||
    "";
  if (rawDate) return rawDate;

  const rawTimestamp =
    (typeof point?.timestamp === "number" && point.timestamp) ||
    (typeof point?.timestamp_gmt === "number" && point.timestamp_gmt) ||
    (typeof point?.timestamp_utc === "number" && point.timestamp_utc) ||
    (typeof point?.time === "number" && point.time) ||
    null;

  if (typeof rawTimestamp === "number") {
    const ms = rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }

  return `#${index + 1}`;
};
