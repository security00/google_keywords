import "server-only";

import { d1Query } from "@/lib/d1";

export type SignalReviewStatus = "all" | "pending" | "accepted" | "rejected";

export type SignalReviewSummaryRow = {
  status: string;
  count: number;
};

export type SignalReviewReasonRow = {
  reason: string;
  count: number;
};

export type SignalReviewCandidate = {
  id: string;
  keyword: string;
  keywordNormalized: string;
  signalScore: number;
  avgHotness: number;
  dataforseoVolume: number;
  accepted: string | null;
  createdAt: string;
  sources: string[];
  evidenceCount: number;
};

export type SignalReviewQueue = {
  status: SignalReviewStatus;
  limit: number;
  summary: SignalReviewSummaryRow[];
  rejectedReasons: SignalReviewReasonRow[];
  candidates: SignalReviewCandidate[];
};

type SignalCandidateRow = {
  id: string;
  keyword: string;
  keyword_normalized: string;
  signal_score: number | null;
  avg_hotness: number | null;
  dataforseo_volume: number | null;
  accepted: string | null;
  created_at: string;
  signal_sources: string | null;
};

export type SignalReviewAction = "approve" | "reject";

type StatusCountRow = {
  status: string;
  count: number;
};

type RejectedReasonRow = {
  reason: string;
  count: number;
};

export const SIGNAL_REVIEW_STATUSES: SignalReviewStatus[] = [
  "all",
  "pending",
  "accepted",
  "rejected",
];

export const clampSignalReviewLimit = (raw: number) => {
  if (!Number.isFinite(raw)) return 20;
  return Math.min(100, Math.max(1, Math.floor(raw)));
};

export const normalizeSignalReviewStatus = (
  raw: string | null | undefined
): SignalReviewStatus => {
  return SIGNAL_REVIEW_STATUSES.includes(raw as SignalReviewStatus)
    ? (raw as SignalReviewStatus)
    : "pending";
};

export const signalReviewStatusClause = (
  status: SignalReviewStatus
): { clause: string; params: string[] } => {
  if (status === "all") return { clause: "", params: [] };
  if (status === "pending") {
    return {
      clause: "WHERE accepted IS NULL OR accepted = 'pending'",
      params: [],
    };
  }
  return { clause: "WHERE accepted LIKE ?", params: [`${status}:%`] };
};

export const parseSignalSourceLabels = (signalSources: string | null): string[] => {
  if (!signalSources) return [];

  try {
    const payload = JSON.parse(signalSources) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];

    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.evidence)) {
      const labels = record.evidence
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return "";
          return String((item as Record<string, unknown>).source_label ?? "").trim();
        })
        .filter(Boolean);
      return [...new Set(labels)].sort();
    }

    return Object.keys(record).sort();
  } catch {
    return [];
  }
};

export const countSignalEvidence = (signalSources: string | null) => {
  if (!signalSources) return 0;

  try {
    const payload = JSON.parse(signalSources) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
    const evidence = (payload as Record<string, unknown>).evidence;
    if (Array.isArray(evidence)) return evidence.length;
    return Object.keys(payload).length;
  } catch {
    return 0;
  }
};

const normalizeSummaryRow = (row: StatusCountRow): SignalReviewSummaryRow => ({
  status: row.status || "pending",
  count: Number(row.count || 0),
});

const normalizeReasonRow = (row: RejectedReasonRow): SignalReviewReasonRow => ({
  reason: row.reason,
  count: Number(row.count || 0),
});

const normalizeCandidateRow = (row: SignalCandidateRow): SignalReviewCandidate => ({
  id: row.id,
  keyword: row.keyword,
  keywordNormalized: row.keyword_normalized,
  signalScore: Number(row.signal_score || 0),
  avgHotness: Number(row.avg_hotness || 0),
  dataforseoVolume: Number(row.dataforseo_volume || 0),
  accepted: row.accepted,
  createdAt: row.created_at,
  sources: parseSignalSourceLabels(row.signal_sources),
  evidenceCount: countSignalEvidence(row.signal_sources),
});

export const normalizeSignalReviewAction = (raw: unknown): SignalReviewAction | null => {
  return raw === "approve" || raw === "reject" ? raw : null;
};

export const normalizeManualRejectReason = (raw: unknown) => {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const slug = text
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return slug || "manual_rejected";
};

export const signalReviewAcceptedValue = (
  action: SignalReviewAction,
  reason?: unknown
) => {
  if (action === "approve") return "accepted:manual:admin_review";
  return `rejected:manual:${normalizeManualRejectReason(reason)}`;
};

export const signalReviewProcessedValue = (action: SignalReviewAction) => {
  return action === "approve" ? 0 : 1;
};

export async function updateSignalReviewCandidate(input: {
  id: string;
  action: SignalReviewAction;
  reason?: unknown;
}) {
  const id = input.id.trim();
  if (!id) throw new Error("Candidate id is required");

  const accepted = signalReviewAcceptedValue(input.action, input.reason);
  const processed = signalReviewProcessedValue(input.action);

  const { rows } = await d1Query<{ id: string }>(
    `UPDATE signal_candidates
     SET accepted = ?, processed = ?
     WHERE id = ?
     RETURNING id`,
    [accepted, processed, id]
  );

  if (!rows.length) throw new Error("Candidate not found");
  return { id: rows[0].id, accepted, processed };
}

export async function getSignalReviewQueue(
  statusInput: string | null | undefined = "pending",
  limitInput = 20
): Promise<SignalReviewQueue> {
  const status = normalizeSignalReviewStatus(statusInput);
  const limit = clampSignalReviewLimit(limitInput);
  const { clause, params } = signalReviewStatusClause(status);

  const [{ rows: summaryRows }, { rows: reasonRows }, { rows: candidateRows }] =
    await Promise.all([
      d1Query<StatusCountRow>(
        `SELECT COALESCE(accepted, 'pending') AS status, COUNT(*) AS count
         FROM signal_candidates
         GROUP BY COALESCE(accepted, 'pending')
         ORDER BY count DESC`
      ),
      d1Query<RejectedReasonRow>(
        `SELECT accepted AS reason, COUNT(*) AS count
         FROM signal_candidates
         WHERE accepted LIKE 'rejected:%'
         GROUP BY accepted
         ORDER BY count DESC`
      ),
      d1Query<SignalCandidateRow>(
        `SELECT id, keyword, keyword_normalized, signal_score, avg_hotness, dataforseo_volume,
                accepted, created_at, signal_sources
         FROM signal_candidates
         ${clause}
         ORDER BY signal_score DESC, created_at DESC
         LIMIT ?`,
        [...params, limit]
      ),
    ]);

  return {
    status,
    limit,
    summary: summaryRows.map(normalizeSummaryRow),
    rejectedReasons: reasonRows.map(normalizeReasonRow),
    candidates: candidateRows.map(normalizeCandidateRow),
  };
}
