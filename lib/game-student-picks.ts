export type StudentGamePickSlot = "weekly_hot" | "diverse";

export type GameKeywordCandidate = {
  keyword: string;
  source_site?: string | null;
  source?: string | null;
  trend_ratio?: number | null;
  trend_slope?: number | null;
  serp_auth?: number | null;
  recommendation?: string | null;
  trend_checked_at?: string | null;
};

export function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function parseCheckedAtMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function isWithinDays(
  checkedAt: string | null | undefined,
  days: number,
  nowMs = Date.now(),
): boolean {
  const ms = parseCheckedAtMs(checkedAt);
  if (ms === null) return false;
  return nowMs - ms <= days * 24 * 60 * 60 * 1000;
}

export function isStudentHotGame(
  row: GameKeywordCandidate,
  minRatio = 1,
): boolean {
  const rec = String(row.recommendation || "");
  if (rec.includes("skip") || rec.includes("watchlist")) return false;
  if (rec.includes("hot") || rec.includes("rising")) return true;
  const ratio = Number(row.trend_ratio) || 0;
  const slope = Number(row.trend_slope) || 0;
  return rec.includes("niche") && ratio >= minRatio && slope > 0;
}

function sourceOf(row: GameKeywordCandidate): string {
  return String(row.source_site || row.source || "");
}

function rowKey(row: GameKeywordCandidate): string {
  return `${row.keyword}\0${sourceOf(row)}`;
}

function trendRatio(row: GameKeywordCandidate): number {
  return Number(row.trend_ratio) || 0;
}

function diversityScore(row: GameKeywordCandidate, usedSources: Set<string>): number {
  const rec = String(row.recommendation || "");
  let score = Math.min(trendRatio(row), 8);
  if (!usedSources.has(sourceOf(row))) score += 100;
  if (rec.includes("hot")) score += 6;
  else if (rec.includes("rising")) score += 3;
  return score;
}

function pickStaggered<T extends GameKeywordCandidate>(
  remaining: T[],
  usedSources: Set<string>,
  userId: string,
  count: number,
): T[] {
  const pool = [...remaining];
  const used = new Set(usedSources);
  const hash = simpleHash(userId);
  const picked: T[] = [];

  for (let n = 0; n < count && pool.length > 0; n++) {
    pool.sort(
      (a, b) =>
        diversityScore(b, used) - diversityScore(a, used) || a.keyword.localeCompare(b.keyword),
    );
    const bestOtherSource = !used.has(sourceOf(pool[0]));
    const band = pool.filter((row) => !used.has(sourceOf(row)) === bestOtherSource);
    const choice = band[(hash + n * 7) % band.length];
    picked.push(choice);
    used.add(sourceOf(choice));
    pool.splice(pool.findIndex((row) => rowKey(row) === rowKey(choice)), 1);
  }

  return picked;
}

export function pickStudentGameKeywords<T extends GameKeywordCandidate>(
  rows: T[],
  userId: string,
  options?: {
    count?: number;
    weeklyWindowDays?: number;
    maxAgeDays?: number;
    minRatio?: number;
    nowMs?: number;
  },
): Array<T & { slot: StudentGamePickSlot }> {
  const count = options?.count ?? 3;
  const weeklyWindowDays = options?.weeklyWindowDays ?? 7;
  const minRatio = options?.minRatio ?? 1;
  const nowMs = options?.nowMs ?? Date.now();
  const fresh =
    options?.maxAgeDays != null
      ? rows.filter((row) => isWithinDays(row.trend_checked_at, options.maxAgeDays as number, nowMs))
      : rows;
  const hot = fresh.filter((row) => isStudentHotGame(row, minRatio));
  if (hot.length === 0 || count <= 0) return [];

  const weekly = hot.filter((row) => isWithinDays(row.trend_checked_at, weeklyWindowDays, nowMs));
  const weeklyKeys = new Set(weekly.map(rowKey));
  const picked = pickStaggered(weekly, new Set(), userId, Math.min(count, weekly.length));
  if (picked.length < count) {
    const used = new Set(picked.map(sourceOf));
    const usedKeys = new Set(picked.map(rowKey));
    const fallback = hot.filter((row) => !usedKeys.has(rowKey(row)));
    picked.push(...pickStaggered(fallback, used, userId, count - picked.length));
  }

  return picked.map((row) => ({
    ...row,
    slot: weeklyKeys.has(rowKey(row)) ? ("weekly_hot" as const) : ("diverse" as const),
  }));
}
