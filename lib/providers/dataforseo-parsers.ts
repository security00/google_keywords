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
        items.push({
          keyword: typeof item.keyword === "string" ? item.keyword : "",
          volume: Number(info?.search_volume ?? 0),
          cpc: Number(info?.cpc ?? 0),
          competition:
            typeof info?.competition_level === "string"
              ? info.competition_level
              : "",
          kd: Number(properties?.keyword_difficulty ?? 0),
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
          if (!point) continue;
          const rawDate =
            typeof point.date_from === "string"
              ? point.date_from
              : typeof point.date === "string"
                ? point.date
                : "";
          if (!rawDate) continue;
          const date = rawDate.slice(0, 10);
          const values = asArray(point.values).map(Number);
          if (keywordIndex >= 0 && values.length > keywordIndex) {
            keywordSeries.push({ date, value: values[keywordIndex] });
          }
          if (benchmarkIndex >= 0 && values.length > benchmarkIndex) {
            benchmarkSeries.push({ date, value: values[benchmarkIndex] });
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
