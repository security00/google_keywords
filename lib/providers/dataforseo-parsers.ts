const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

export type KeywordSuggestion = {
  keyword: string;
  volume: number;
  cpc: number;
  competition: string;
  kd: number;
  kdMissing?: boolean;
  monthlySearches?: Array<{ month: string; searches: number }>;
};
export const parseKeywordSuggestionsResponse = (
  response: unknown,
): KeywordSuggestion[] => {
  const items: KeywordSuggestion[] = [];
  const root = asRecord(response);
  for (const taskValue of asArray(root?.tasks)) {
    const task = asRecord(taskValue);
    for (const resultValue of asArray(task?.result)) {
      const result = asRecord(resultValue);
      for (const itemValue of asArray(result?.items)) {
        const item = asRecord(itemValue);
        if (!item) continue;
        const info = asRecord(item.keyword_info);
        const properties = asRecord(item.keyword_properties);
        const months = new Map<string, number>();
        for (const point of asArray(info?.monthly_searches)) {
          const p = asRecord(point);
          if (typeof p?.year !== "number" || !Number.isInteger(p.year) || p.year < 2000 || p.year > 2100 ||
              typeof p.month !== "number" || !Number.isInteger(p.month) || p.month < 1 || p.month > 12 ||
              typeof p.search_volume !== "number" || !Number.isFinite(p.search_volume) || p.search_volume < 0) continue;
          months.set(`${p.year}-${String(p.month).padStart(2, "0")}`, p.search_volume);
        }
        items.push({
          keyword: typeof item.keyword === "string" ? item.keyword : "",
          volume: Number(info?.search_volume ?? 0),
          cpc: Number(info?.cpc ?? 0),
          competition:
            typeof info?.competition_level === "string"
              ? info.competition_level
              : "",
          kd: Number(properties?.keyword_difficulty ?? 0),
          ...(properties?.keyword_difficulty == null ? { kdMissing: true } : {}),
          ...(months.size ? { monthlySearches: [...months].sort().slice(-12).map(([month, searches]) => ({ month, searches })) } : {}),
        });
      }
    }
  }
  return items;
};

export type TrendPoint = { date: string; value: number };

export const parseLiveTrendsResponse = (
  response: unknown,
  keyword: string,
  benchmark: string,
) => {
  const keywordSeries: TrendPoint[] = [];
  const benchmarkSeries: TrendPoint[] = [];
  let debugRaw: string | null = null;
  const root = asRecord(response);

  for (const taskValue of asArray(root?.tasks)) {
    const task = asRecord(taskValue);
    for (const resultValue of asArray(task?.result)) {
      const result = asRecord(resultValue);
      for (const itemValue of asArray(result?.items)) {
        const item = asRecord(itemValue);
        if (!item || item.type !== "google_trends_graph") continue;
        const itemKeywords = asArray(item.keywords).filter(
          (value): value is string => typeof value === "string",
        );
        const keywordIndex = itemKeywords.indexOf(keyword);
        const benchmarkIndex = itemKeywords.indexOf(benchmark);
        const points = asArray(item.data);
        if (!debugRaw && points.length > 0) {
          debugRaw = JSON.stringify(points[0]);
        }

        for (const pointValue of points) {
          const point = asRecord(pointValue);
          if (!point || point.missing_data === true) continue;
          const rawDate =
            typeof point.date_from === "string"
              ? point.date_from
              : typeof point.date === "string"
                ? point.date
                : "";
          if (!rawDate) continue;
          const date = rawDate.slice(0, 10);
          const values = asArray(point.values);
          const kw = values[keywordIndex];
          const bm = values[benchmarkIndex];
          if (typeof kw === "number" && Number.isFinite(kw)) {
            keywordSeries.push({ date, value: kw });
          }
          if (typeof bm === "number" && Number.isFinite(bm)) {
            benchmarkSeries.push({ date, value: bm });
          }
        }
      }
    }
  }

  return { keywordSeries, benchmarkSeries, debugRaw };
};

export const extractRootCost = (response: unknown) => {
  const cost = asRecord(response)?.cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : null;
};
