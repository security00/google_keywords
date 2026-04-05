"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { pollTaskUntilComplete } from "@/lib/client/task-poller";
import { ComparisonResultsCard } from "@/components/comparison-results";
import type { CompareResponse, ComparisonSignalConfig } from "@/lib/types";

type SitemapSource = {
  id: string;
  name: string | null;
  sitemapUrl: string;
  enabled: boolean;
  rulesJson?: string | null;
  lastCheckedAt?: string | null;
  checkIntervalMinutes?: number;
  nextCheckAt?: string | null;
};

type DiscoveredKeyword = {
  id: string;
  keyword: string;
  status: string;
  url: string;
  extractedAt: string;
  sourceId: string;
  sourceName: string | null;
  sitemapUrl: string;
};

type ScanItem = {
  id: string;
  label: string;
  status: "pending" | "scanning" | "done" | "skipped" | "failed";
  message?: string;
};

type Notice = {
  type: "info" | "success" | "error";
  text: string;
};

const DEFAULT_SOURCES: Array<{ name: string; sitemapUrl: string }> = [
  { name: "CrazyGames", sitemapUrl: "https://www.crazygames.com/sitemap-index.xml" },
  { name: "OnlineGames", sitemapUrl: "https://www.onlinegames.io/sitemap.xml" },
  { name: "GeometryDashLitePC", sitemapUrl: "https://geometrydashlitepc.io/sitemap.xml" },
  { name: "TruckGamesParking", sitemapUrl: "https://www.truckgamesparking.com/game-sitemap.xml" },
  { name: "Arkadium", sitemapUrl: "https://www.arkadium.com/sitemap.xml" },
  { name: "Minijuegos", sitemapUrl: "https://www.minijuegos.com/sitemap-games-3.xml" },
  { name: "GeometryGames", sitemapUrl: "https://geometrygames.io/sitemap.xml" },
  { name: "GeometryGame", sitemapUrl: "https://geometrygame.org/sitemap.xml" },
  { name: "GeometryLite", sitemapUrl: "https://geometry-lite.io/sitemap.xml" },
  { name: "NowGG", sitemapUrl: "https://now.gg/sitemap.xml" },
  { name: "IoGames", sitemapUrl: "https://iogames.onl/sitemap.xml" },
  { name: "FreeGames", sitemapUrl: "https://www.freegames.com/sitemap/games_1.xml" },
  { name: "CoolMathGames", sitemapUrl: "https://www.coolmathgames.com/sitemap.xml" },
  { name: "Friv", sitemapUrl: "https://www.friv.com/sitemap.xml" },
  { name: "ArmorGames", sitemapUrl: "https://armorgames.com/sitemap.xml" },
  { name: "Bloxd", sitemapUrl: "https://bloxd.io/sitemap.xml" },
  { name: "Lagged", sitemapUrl: "https://lagged.com/sitemap.xml" },
  { name: "GameMonetize", sitemapUrl: "https://gamemonetize.com/sitemap.xml" },
  { name: "Gamiary", sitemapUrl: "https://gamiary.com/sitemap.xml" },
  { name: "CrazyCattle3D", sitemapUrl: "https://crazycattle3d.io/sitemap.xml" },
];

const SOURCE_DISPLAY_LIMIT = 8;
const DEFAULT_COMPARE_BUDGET = 120;
const MIN_COMPARE_BUDGET = 10;
const MAX_COMPARE_BUDGET = 400;
const DEFAULT_COMPARISON_SIGNAL_CONFIG: ComparisonSignalConfig = {
  avgRatioMin: 1,
  lastPointRatioMin: 1,
  peakRatioMin: 1.2,
  slopeRatioMinStrong: 1.35,
  slopeRatioMinPass: 0.9,
  risingStrongMinSlopeRatio: 1.35,
  risingStrongMinTailRatio: 1,
  nearOneTolerance: 0.1,
};
const COMPARISON_SIGNAL_CONFIG_FIELDS: Array<{
  key: keyof ComparisonSignalConfig;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: string;
}> = [
  {
    key: "avgRatioMin",
    label: "平均比值阈值",
    hint: "候选搜索量均值 / 基准均值，超过该比例进入候选",
    min: 0.2,
    max: 10,
    step: "0.01",
  },
  {
    key: "lastPointRatioMin",
    label: "末端比值阈值",
    hint: "最近窗口末端候选/基准比值，判断“当前是否超过 gpts”",
    min: 0.2,
    max: 10,
    step: "0.01",
  },
  {
    key: "peakRatioMin",
    label: "峰值比值阈值",
    hint: "候选峰值 / 基准峰值，检测近期冲高",
    min: 0.2,
    max: 10,
    step: "0.01",
  },
  {
    key: "slopeRatioMinStrong",
    label: "斜率强势阈值",
    hint: "候选斜率 / 基准斜率，越大表示升势更陡",
    min: 0.5,
    max: 20,
    step: "0.01",
  },
  {
    key: "slopeRatioMinPass",
    label: "斜率通过阈值",
    hint: "中等强度上升信号的阈值，影响较弱词是否能通过",
    min: 0.2,
    max: 20,
    step: "0.01",
  },
  {
    key: "risingStrongMinSlopeRatio",
    label: "强势 rising 斜率阈值",
    hint: "新增词上升强势时，候选/基准斜率阈值",
    min: 0.5,
    max: 20,
    step: "0.01",
  },
  {
    key: "risingStrongMinTailRatio",
    label: "强势上升尾端阈值",
    hint: "rising 样本末端 / 基准末端最小比例",
    min: 0.2,
    max: 10,
    step: "0.01",
  },
  {
    key: "nearOneTolerance",
    label: "1 附近容差",
    hint: "末端比值接近 1 的容忍范围（用于 rising 强判定）",
    min: 0.01,
    max: 0.5,
    step: "0.01",
  },
];

type ComparisonSignalConfigInput = Record<keyof ComparisonSignalConfig, string>;

type ComparisonSignalPresetKey = "conservative" | "balanced" | "aggressive" | "custom";

type ComparisonSignalPreset = {
  key: ComparisonSignalPresetKey;
  label: string;
  values: ComparisonSignalConfig;
};

const COMPARISON_SIGNAL_PRESETS: ComparisonSignalPreset[] = [
  {
    key: "conservative",
    label: "保守",
    values: {
      avgRatioMin: 1.2,
      lastPointRatioMin: 1.2,
      peakRatioMin: 1.4,
      slopeRatioMinStrong: 1.8,
      slopeRatioMinPass: 1.05,
      risingStrongMinSlopeRatio: 1.65,
      risingStrongMinTailRatio: 1.2,
      nearOneTolerance: 0.08,
    },
  },
  {
    key: "balanced",
    label: "平衡",
    values: DEFAULT_COMPARISON_SIGNAL_CONFIG,
  },
  {
    key: "aggressive",
    label: "激进",
    values: {
      avgRatioMin: 0.95,
      lastPointRatioMin: 0.95,
      peakRatioMin: 1.1,
      slopeRatioMinStrong: 1.2,
      slopeRatioMinPass: 0.75,
      risingStrongMinSlopeRatio: 1.2,
      risingStrongMinTailRatio: 0.95,
      nearOneTolerance: 0.15,
    },
  },
];

const toComparisonSignalConfigInput = (config: ComparisonSignalConfig): ComparisonSignalConfigInput =>
  COMPARISON_SIGNAL_CONFIG_FIELDS.reduce((acc, field) => {
    acc[field.key] = String(config[field.key]);
    return acc;
  }, {} as ComparisonSignalConfigInput);

const parseComparisonSignalConfigInput = (
  input: ComparisonSignalConfigInput,
): ComparisonSignalConfig => {
  return COMPARISON_SIGNAL_CONFIG_FIELDS.reduce((acc, field) => {
    const candidate = Number(input[field.key]);
    const base = Number.isFinite(candidate) ? candidate : DEFAULT_COMPARISON_SIGNAL_CONFIG[field.key];
    const normalized = Math.min(field.max, Math.max(field.min, base));
    acc[field.key] = normalized;
    return acc;
  }, {} as ComparisonSignalConfig);
};

const clampAndStringifyComparisonSignalConfig = (config: ComparisonSignalConfig): ComparisonSignalConfigInput =>
  toComparisonSignalConfigInput(parseComparisonSignalConfigInput(toComparisonSignalConfigInput(config)));

const getSignalPresetKey = (config: ComparisonSignalConfig): ComparisonSignalPresetKey => {
  const normalized = parseComparisonSignalConfigInput(toComparisonSignalConfigInput(config));
  const matched = COMPARISON_SIGNAL_PRESETS.find((preset) =>
    COMPARISON_SIGNAL_CONFIG_FIELDS.every(
      (field) => Math.abs(preset.values[field.key] - normalized[field.key]) < 1e-9
    )
  );
  if (matched) {
    return matched.key;
  }
  return "custom";
};

type CompareMode = "manual" | "recent" | "priority";

function formatUtcDateTime(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function getSourceDomain(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatNextCheckLabel(value?: string | null): string {
  if (!value) return "未安排";
  return formatUtcDateTime(value);
}

const runWithConcurrency = async <T,>(
  items: T[],
  worker: (item: T) => Promise<void>,
  limit: number
) => {
  if (items.length === 0) return;
  const concurrency = Math.max(1, Math.min(limit, items.length));
  let index = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        const item = items[current];
        await worker(item);
      }
    })
  );
};

export default function DiscoveryPage() {
  const [sources, setSources] = useState<SitemapSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [scanItems, setScanItems] = useState<ScanItem[]>([]);
  const [ignoreFirstScan, setIgnoreFirstScan] = useState(true);
  const [showManage, setShowManage] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanConcurrency, setScanConcurrency] = useState(3);
  const [scanConcurrencyInput, setScanConcurrencyInput] = useState("3");
  const [showCompareSignalConfig, setShowCompareSignalConfig] = useState(false);
  const [comparisonSignalConfigInput, setComparisonSignalConfigInput] = useState<ComparisonSignalConfigInput>(
    toComparisonSignalConfigInput(DEFAULT_COMPARISON_SIGNAL_CONFIG)
  );
  const [comparisonSignalConfig, setComparisonSignalConfig] =
    useState<ComparisonSignalConfig>(DEFAULT_COMPARISON_SIGNAL_CONFIG);
  const [comparisonSignalPresetKey, setComparisonSignalPresetKey] = useState<ComparisonSignalPresetKey>("balanced");

  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceRules, setNewSourceRules] = useState("");
  const [newSourceCheckIntervalMinutes, setNewSourceCheckIntervalMinutes] = useState("60");

  const [keywords, setKeywords] = useState<DiscoveredKeyword[]>([]);
  const [keywordsTotal, setKeywordsTotal] = useState(0);
  const [keywordsPage, setKeywordsPage] = useState(1);
  const [keywordsLimit, setKeywordsLimit] = useState(50);
  const [statusFilter, setStatusFilter] = useState("new");
  const [sourceFilter, setSourceFilter] = useState("");
  const [query, setQuery] = useState("");
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [compareData, setCompareData] = useState<CompareResponse | null>(null);
  const [compareProgress, setCompareProgress] = useState<{ ready: number; total: number } | null>(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [compareBudgetInput, setCompareBudgetInput] = useState(String(DEFAULT_COMPARE_BUDGET));
  const [compareBudget, setCompareBudget] = useState(DEFAULT_COMPARE_BUDGET);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number; current: string } | null>(null);

  const selectedKeywords = useMemo(() => {
    const map = new Map(keywords.map((item) => [item.id, item.keyword]));
    return Array.from(selectedIds)
      .map((id) => map.get(id))
      .filter(Boolean) as string[];
  }, [keywords, selectedIds]);

  const enabledSourcesCount = useMemo(() => sources.filter((source) => source.enabled).length, [sources]);
  const visibleSources = useMemo(
    () => (showAllSources ? sources : sources.slice(0, SOURCE_DISPLAY_LIMIT)),
    [showAllSources, sources]
  );

  const loadSources = useCallback(async () => {
    setLoadingSources(true);
    try {
      const response = await fetch("/api/sitemaps/sources", {
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("未登录或会话已失效，请重新登录");
        }
        throw new Error(payload?.error || "加载来源失败");
      }
      const loadedSources = payload.sources ?? [];
      if (loadedSources.length > 0) {
        setNotice(null);
      }
      setSources(loadedSources);
      if (loadedSources.length === 0) {
        setNotice({
          type: "info",
          text: "当前账号未发现来源记录，请点击“导入默认来源”先初始化",
        });
      }
      setShowAllSources(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载来源失败";
      console.log("[discovery] load sources failed", error);
      setSources([]);
      setNotice({ type: "error", text: message });
    } finally {
      setLoadingSources(false);
    }
  }, []);

  const loadKeywords = useCallback(async () => {
    setLoadingKeywords(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (sourceFilter) params.set("sourceId", sourceFilter);
      if (query) params.set("q", query);
      params.set("page", String(keywordsPage));
      params.set("limit", String(keywordsLimit));

      const response = await fetch(`/api/sitemaps/keywords?${params.toString()}`, {
        credentials: "include",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "加载关键词失败");
      }
      setKeywords(payload.keywords ?? []);
      setKeywordsTotal(payload.total ?? 0);
      setSelectedIds(new Set());
    } catch (error) {
      console.log("[discovery] load keywords failed", error);
      setKeywords([]);
      setKeywordsTotal(0);
    } finally {
      setLoadingKeywords(false);
    }
  }, [keywordsLimit, keywordsPage, query, sourceFilter, statusFilter]);

  const markScanProgress = useCallback((label: string) => {
    setScanProgress((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        done: Math.min(prev.done + 1, prev.total),
        current: label,
      };
    });
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  useEffect(() => {
    loadKeywords();
  }, [loadKeywords]);

  useEffect(() => {
    setScanConcurrencyInput(String(scanConcurrency));
  }, [scanConcurrency]);

  const handleAddSource = async () => {
    const sitemapUrl = newSourceUrl.trim();
    if (!sitemapUrl) return;

    const intervalRaw = Number(newSourceCheckIntervalMinutes);
    const interval = Number.isFinite(intervalRaw) && intervalRaw > 0 ? Math.floor(intervalRaw) : 60;

    try {
      const response = await fetch("/api/sitemaps/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newSourceName.trim() || undefined,
          sitemapUrl,
          rulesJson: newSourceRules.trim() || undefined,
          checkIntervalMinutes: interval,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "添加来源失败");
      }
      const inserted = typeof payload?.inserted === "number" ? payload.inserted : 0;
      setNewSourceName("");
      setNewSourceUrl("");
      setNewSourceRules("");
      setNewSourceCheckIntervalMinutes("60");
      await loadSources();
      if (inserted > 0) {
        setNotice({ type: "success", text: `来源已添加（${inserted}条）` });
      } else {
        setNotice({ type: "info", text: "来源已存在，未新增记录" });
      }
    } catch (error) {
      console.log("[discovery] add source failed", error);
      const message = error instanceof Error ? error.message : "添加来源失败";
      setNotice({ type: "error", text: message });
    }
  };

  const handleImportDefaults = async () => {
    setNotice(null);
    try {
      const response = await fetch("/api/sitemaps/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sources: DEFAULT_SOURCES }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "导入默认来源失败");
      }
      const inserted = typeof payload?.inserted === "number" ? payload.inserted : 0;
      if (inserted > 0) {
        setNotice({ type: "success", text: `已导入 ${inserted} 个默认来源` });
      } else {
        setNotice({ type: "info", text: "默认来源已存在，未新增记录" });
      }
      await loadSources();
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入默认来源失败";
      setNotice({ type: "error", text: message });
      console.log("[discovery] import defaults failed", error);
    }
  };

  const upsertScanItem = (id: string, label: string, patch: Partial<ScanItem>) => {
    setScanItems((prev) => {
      const exists = prev.some((item) => item.id === id);
      if (!exists) {
        return [...prev, { id, label, status: "pending", ...patch }];
      }
      return prev.map((item) => (item.id === id ? { ...item, label, ...patch } : item));
    });
  };

  const scanSource = async (source: SitemapSource) => {
    upsertScanItem(source.id, source.name ?? source.sitemapUrl, { status: "scanning" });
    setScanProgress((prev) => (prev ? { ...prev, current: source.name ?? source.sitemapUrl } : prev));
    try {
      const response = await fetch("/api/sitemaps/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sourceId: source.id,
          ignoreFirstScan,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "扫描失败");
      }

      const result = (payload.results ?? [])[0];
      if (!result) {
        throw new Error("未返回扫描结果");
      }

      if (result.error) {
        upsertScanItem(source.id, source.name ?? source.sitemapUrl, {
          status: "failed",
          message: result.error,
        });
        markScanProgress(source.name ?? source.sitemapUrl);
        return;
      }

      if (result.skipped) {
        upsertScanItem(source.id, source.name ?? source.sitemapUrl, {
          status: "skipped",
          message: "已跳过：sitemap 未更新",
        });
        markScanProgress(source.name ?? source.sitemapUrl);
        return;
      }

      upsertScanItem(source.id, source.name ?? source.sitemapUrl, {
        status: "done",
        message: `URL=${result.totalUrls}，新增 URL=${result.newUrls}，新增关键词=${result.newKeywords}，耗时=${result.tookMs}ms`,
      });
      markScanProgress(source.name ?? source.sitemapUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "扫描失败";
      console.log("[discovery] scan failed", error);
      upsertScanItem(source.id, source.name ?? source.sitemapUrl, {
        status: "failed",
        message,
      });
      markScanProgress(source.name ?? source.sitemapUrl);
    }
  };

  const handleScanAll = async () => {
    if (isScanning) return;
    const enabledSources = sources.filter((source) => source.enabled);
    const targetSources = enabledSources.length > 0 ? enabledSources : sources;
    if (targetSources.length === 0) {
      setScanStatus("暂无可扫描来源，请先添加来源");
      return;
    }

    setIsScanning(true);
    try {
      if (enabledSources.length === 0 && sources.length > 0) {
        setScanStatus("未检测到启用来源，已改为扫描全部来源");
      } else {
        setScanStatus("正在扫描...");
      }

      setScanItems(
        targetSources.map((source) => ({
          id: source.id,
          label: source.name ?? source.sitemapUrl,
          status: "pending",
        }))
      );
      setScanProgress({
        done: 0,
        total: targetSources.length,
        current: "",
      });

      const concurrency = Math.max(1, Math.min(scanConcurrency, targetSources.length, 10));
      await runWithConcurrency(targetSources, scanSource, concurrency);

      setScanStatus("扫描完成");
      setScanProgress((prev) => (prev ? { ...prev, done: prev.total, current: "完成" } : prev));
      await loadKeywords();
      await loadSources();
    } finally {
      setIsScanning(false);
    }
  };

  const handleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === keywords.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(keywords.map((item) => item.id)));
  };

  const handleMarkStatus = async (status: string, ids?: Iterable<string>) => {
    const targetIds = ids ? Array.from(ids) : Array.from(selectedIds);
    const dedupeIds = Array.from(new Set(targetIds));
    if (dedupeIds.length === 0) return;
    try {
      const response = await fetch("/api/sitemaps/keywords/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: dedupeIds, status }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "更新失败");
      }
      await loadKeywords();
    } catch (error) {
      const message = error instanceof Error ? error.message : "状态更新失败";
      setNotice({ type: "error", text: message });
      console.log("[discovery] mark status failed", error);
    }
  };

  const getStatusLabel = (status: string) => {
    if (status === "new") return "待处理";
    if (status === "compared") return "已对比";
    if (status === "ignored") return "已忽略";
    return status;
  };

  const handleScanConcurrencyChange = (value: string) => {
    const filtered = value.replace(/[^0-9]/g, "");
    setScanConcurrencyInput(filtered);
    if (!filtered) return;
    const parsed = Number(filtered);
    if (!Number.isFinite(parsed)) return;
    setScanConcurrency(Math.max(1, Math.min(10, Math.floor(parsed))));
  };

  const handleScanConcurrencyBlur = () => {
    const parsed = Number(scanConcurrencyInput);
    if (!scanConcurrencyInput || Number.isNaN(parsed)) {
      setScanConcurrencyInput(String(scanConcurrency));
      return;
    }
    const normalized = Math.max(1, Math.min(10, Math.floor(parsed)));
    setScanConcurrency(normalized);
    setScanConcurrencyInput(String(normalized));
  };

  const handleCompareBudgetChange = (value: string) => {
    const filtered = value.replace(/[^0-9]/g, "");
    setCompareBudgetInput(filtered);
    if (!filtered) return;
    const parsed = Number(filtered);
    if (!Number.isFinite(parsed)) return;
    setCompareBudget(Math.max(MIN_COMPARE_BUDGET, Math.min(MAX_COMPARE_BUDGET, Math.floor(parsed))));
  };

  const handleCompareBudgetBlur = () => {
    const parsed = Number(compareBudgetInput);
    if (!compareBudgetInput || Number.isNaN(parsed)) {
      setCompareBudget(DEFAULT_COMPARE_BUDGET);
      setCompareBudgetInput(String(DEFAULT_COMPARE_BUDGET));
      return;
    }
    const normalized = Math.max(
      MIN_COMPARE_BUDGET,
      Math.min(MAX_COMPARE_BUDGET, Math.floor(parsed))
    );
    setCompareBudget(normalized);
    setCompareBudgetInput(String(normalized));
  };

  const handleComparisonSignalConfigInputChange = (
    key: keyof ComparisonSignalConfig,
    value: string
  ) => {
    const filtered = value.replace(/[^0-9.]/g, "");
    setComparisonSignalPresetKey("custom");
    setComparisonSignalConfigInput((prev) => ({ ...prev, [key]: filtered }));
  };

  const handleComparisonSignalConfigBlur = () => {
    const parsed = parseComparisonSignalConfigInput(comparisonSignalConfigInput);
    setComparisonSignalConfig(parsed);
    setComparisonSignalPresetKey(getSignalPresetKey(parsed));
    setComparisonSignalConfigInput(clampAndStringifyComparisonSignalConfig(parsed));
  };

  const resetComparisonSignalConfig = () => {
    const normalized = COMPARISON_SIGNAL_PRESETS.find((item) => item.key === "balanced")?.values ??
      DEFAULT_COMPARISON_SIGNAL_CONFIG;
    setComparisonSignalConfig(normalized);
    setComparisonSignalConfigInput(clampAndStringifyComparisonSignalConfig(normalized));
    setComparisonSignalPresetKey("balanced");
  };

  const applyComparisonSignalPreset = (presetKey: ComparisonSignalPresetKey) => {
    const preset = COMPARISON_SIGNAL_PRESETS.find((item) => item.key === presetKey);
    if (!preset) return;
    const normalized = parseComparisonSignalConfigInput(toComparisonSignalConfigInput(preset.values));
    setComparisonSignalConfig(normalized);
    setComparisonSignalConfigInput(clampAndStringifyComparisonSignalConfig(normalized));
    setComparisonSignalPresetKey(preset.key);
  };

  const getCompareModeLabel = (mode: CompareMode) => {
    if (mode === "recent") return "最近24小时";
    if (mode === "priority") return "高优先词";
    return "手动选择";
  };

  const handleCompare = async (mode: CompareMode = "manual") => {
    if (mode === "manual" && selectedKeywords.length === 0) return;
    setLoadingCompare(true);
    setCompareProgress({ ready: 0, total: 0 });
    setCompareData(null);
    setNotice(null);

    try {
      const payloadComparisonConfig = parseComparisonSignalConfigInput(comparisonSignalConfigInput);
      setComparisonSignalPresetKey(getSignalPresetKey(payloadComparisonConfig));
      setComparisonSignalConfig(payloadComparisonConfig);
      setComparisonSignalConfigInput(clampAndStringifyComparisonSignalConfig(payloadComparisonConfig));
      const payloadBody: Record<string, unknown> = {
        strategy: mode === "manual" ? "manual" : mode,
      };

      if (mode === "manual") {
        payloadBody.keywords = selectedKeywords;
        payloadBody.keywordIds = Array.from(selectedIds);
      } else {
        payloadBody.maxItems = compareBudget;
      }
      payloadBody.comparisonSignalConfig = payloadComparisonConfig;

      const response = await fetch("/api/research/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payloadBody),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "发起对比失败");

      if (!payload?.jobId) {
        throw new Error("缺少任务ID");
      }
      const jobId = payload.jobId as string;
      const completedPayload = await pollTaskUntilComplete<CompareResponse>({
        jobId,
        statusUrl: "/api/research/compare/status",
        maxWaitMs: 10 * 60_000,
        pollIntervalMs: 5_000,
        requestErrorMessage: "Compare request failed",
        failedErrorMessage: "对比失败",
        throwOnTimeout: false,
        onPending: (pollPayload) => {
          if (pollPayload?.ready !== undefined && pollPayload?.total !== undefined) {
            setCompareProgress({
              ready: Number(pollPayload.ready ?? 0),
              total: Number(pollPayload.total ?? 0),
            });
          }
        },
      });

      if (completedPayload) {
        setCompareData(completedPayload);
        if (mode === "manual") {
          await handleMarkStatus("compared");
        } else if (Array.isArray(payload.keywordIds) && payload.keywordIds.length > 0) {
          await handleMarkStatus("compared", payload.keywordIds as string[]);
          setNotice({
            type: "info",
            text: `策略 ${getCompareModeLabel(mode)} 已发起 ${payload.selectedCount ?? 0} 条，超参预算 ${compareBudget}`,
          });
        } else {
          setNotice({
            type: "info",
            text: `策略 ${getCompareModeLabel(mode)} 未返回可比对关键词，请稍后重试`,
          });
        }
      }
    } catch (error) {
      console.log("[discovery] compare failed", error);
      const message = error instanceof Error ? error.message : "对比失败";
      setNotice({ type: "error", text: message });
    } finally {
      setLoadingCompare(false);
      setCompareProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>站点来源</CardTitle>
          <CardDescription>
            扫描已知游戏站点的 sitemap，发现候选关键词。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {notice && (
              <div
                className={
                  notice.type === "success"
                    ? "w-full rounded bg-emerald-500/10 p-2 text-xs text-emerald-200"
                    : notice.type === "info"
                      ? "w-full rounded bg-sky-500/10 p-2 text-xs text-sky-200"
                      : "w-full rounded bg-rose-500/10 p-2 text-xs text-rose-200"
                }
              >
                {notice.text}
              </div>
            )}
            <Button
              variant="secondary"
              onClick={handleScanAll}
              disabled={isScanning}
            >
              {isScanning ? "扫描中..." : "扫描全部来源"}
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              并发
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="h-8 w-16"
                value={scanConcurrencyInput}
                onChange={(event) => handleScanConcurrencyChange(event.target.value)}
                onBlur={handleScanConcurrencyBlur}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <Button
              variant="outline"
              onClick={() => {
                setShowManage((prev) => !prev);
                if (!showManage) setShowAllSources(false);
              }}
            >
              {showManage ? "收起来源管理" : "管理来源"}
            </Button>
            {sources.length === 0 && (
              <Button variant="outline" onClick={handleImportDefaults}>
                导入默认来源
              </Button>
            )}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="rounded border-zinc-300 text-primary focus:ring-ring"
                checked={ignoreFirstScan}
                onChange={(event) => setIgnoreFirstScan(event.target.checked)}
              />
              首次扫描不入库
            </label>
            <span className="text-xs text-muted-foreground">
              来源总数：{sources.length}，已启用：{enabledSourcesCount}
            </span>
            {scanStatus && <span className="text-xs text-muted-foreground">{scanStatus}</span>}
            {scanProgress && (
              <div className="flex w-full flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  扫描进度：{scanProgress.done}/{scanProgress.total}
                  {scanProgress.current ? `（${scanProgress.current}）` : ""}
                </span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                    style={{
                      width: `${scanProgress.total > 0 ? Math.min(100, Math.round((scanProgress.done / scanProgress.total) * 100)) : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md bg-black p-3 text-xs font-mono text-emerald-100 space-y-1">
            {scanItems.length === 0 ? (
              <div className="text-emerald-200/70">暂无扫描记录，请先选择来源或先扫描全部。</div>
            ) : (
              scanItems.map((item) => (
                <div key={`scan-${item.id}`} className="flex flex-wrap items-center gap-2">
                  <span className="text-emerald-300/80">{item.label}</span>
                  {item.status === "pending" && <span className="text-zinc-300">排队中</span>}
                  {item.status === "scanning" && <span className="text-amber-300">扫描中</span>}
                  {item.status === "skipped" && <span className="text-sky-300">{item.message ?? "已跳过"}</span>}
                  {item.status === "done" && <span className="text-emerald-200">{item.message ?? "完成"}</span>}
                  {item.status === "failed" && (
                    <span className="text-rose-300">失败 {item.message ? `(${item.message})` : ""}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>

        {showManage && (
          <CardFooter className="flex flex-col gap-4">
            <div className="w-full space-y-3">
              <div className="grid gap-3 md:grid-cols-4">
                <Input
                  placeholder="来源名称（可选）"
                  value={newSourceName}
                  onChange={(event) => setNewSourceName(event.target.value)}
                />
                <Input
                  placeholder="站点地图地址"
                  value={newSourceUrl}
                  onChange={(event) => setNewSourceUrl(event.target.value)}
                />
                <Input
                  type="number"
                  min={1}
                  placeholder="检查间隔（分钟）"
                  value={newSourceCheckIntervalMinutes}
                  onChange={(event) => setNewSourceCheckIntervalMinutes(event.target.value)}
                />
                <Button onClick={handleAddSource}>添加来源</Button>
              </div>
              <Textarea
                placeholder='规则 JSON（可选），例如：{ "mode": "last" }'
                value={newSourceRules}
                onChange={(event) => setNewSourceRules(event.target.value)}
              />
              <Button variant="outline" onClick={handleImportDefaults}>
                导入默认来源
              </Button>
            </div>

             {loadingSources && <span className="text-xs text-muted-foreground">正在加载来源...</span>}

             {!loadingSources && sources.length === 0 ? (
               <div className="text-xs text-muted-foreground">暂无来源。</div>
             ) : (
               <div className="space-y-2">
                 <div
                   className={cn(
                     "grid gap-3 md:grid-cols-2",
                     showAllSources ? "max-h-80 overflow-y-auto pr-1" : ""
                   )}
                 >
                   {visibleSources.map((source) => (
                     <div
                       key={source.id}
                       className="group rounded-xl border border-border/70 bg-gradient-to-br from-background to-muted/30 p-3 text-xs shadow-sm transition hover:-translate-y-0.5 hover:border-sky-500/60 hover:shadow-md"
                     >
                       <div className="flex items-start justify-between gap-2">
                         <div className="min-w-0">
                           <div className="truncate text-sm font-semibold text-foreground">
                             {source.name ?? getSourceDomain(source.sitemapUrl)}
                           </div>
                           <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                             {getSourceDomain(source.sitemapUrl)}
                           </div>
                         </div>
                         <span
                           className={cn(
                             "rounded-full px-2 py-0.5 text-[10px] font-medium",
                             source.enabled
                               ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                               : "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
                           )}
                         >
                           {source.enabled ? "已启用" : "已停用"}
                         </span>
                       </div>
                       <div className="mt-2 flex flex-wrap gap-1.5">
                         <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">
                           间隔 {source.checkIntervalMinutes ?? 60} 分钟
                         </span>
                         <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] text-zinc-700 dark:text-zinc-300">
                           下次 {formatNextCheckLabel(source.nextCheckAt)}
                         </span>
                       </div>
                       <div className="mt-2 truncate rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                         {source.sitemapUrl}
                       </div>
                     </div>
                   ))}
                 </div>
                 {sources.length > SOURCE_DISPLAY_LIMIT && (
                   <Button
                     variant="ghost"
                     size="sm"
                     onClick={() => setShowAllSources((prev) => !prev)}
                     className="h-8 px-3 text-xs"
                   >
                     {showAllSources ? "收起来源列表" : `展开更多来源（${sources.length - SOURCE_DISPLAY_LIMIT} 条）`}
                   </Button>
                 )}
               </div>
             )}
          </CardFooter>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>新发现关键词</CardTitle>
          <CardDescription>筛选并对比新发现的关键词。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={statusFilter}
              onChange={(event) => {
                setKeywordsPage(1);
                setStatusFilter(event.target.value);
              }}
            >
              <option value="new">待处理</option>
              <option value="compared">已对比</option>
              <option value="ignored">已忽略</option>
              <option value="">全部</option>
            </select>

            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={sourceFilter}
              onChange={(event) => {
                setKeywordsPage(1);
                setSourceFilter(event.target.value);
              }}
            >
              <option value="">全部来源</option>
              {sources.map((source) => (
                <option key={`source-filter-${source.id}`} value={source.id}>
                  {source.name ?? source.sitemapUrl}
                </option>
              ))}
            </select>

            <Input
              className="max-w-xs"
              placeholder="关键词 / URL"
              value={query}
              onChange={(event) => {
                setKeywordsPage(1);
                setQuery(event.target.value);
              }}
            />

            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={keywordsLimit}
              onChange={(event) => {
                setKeywordsPage(1);
                setKeywordsLimit(Number(event.target.value));
              }}
            >
              {[20, 50, 100, 200].map((value) => (
                <option key={`limit-${value}`} value={value}>
                  {value}条/页
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={handleSelectAll}>
              {selectedIds.size === keywords.length ? "取消全选" : "全选"}
            </Button>
            <Button onClick={() => handleCompare("manual")} disabled={loadingCompare || selectedKeywords.length === 0}>
              {loadingCompare ? "对比中..." : "对比所选"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleCompare("recent")}
              disabled={loadingCompare}
            >
              对比最近新词
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleCompare("priority")}
              disabled={loadingCompare}
            >
              对比高优先词
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleMarkStatus("ignored")}
              disabled={selectedIds.size === 0}
            >
              标记已忽略
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              对比预算
              <Input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="h-8 w-16"
                value={compareBudgetInput}
                onChange={(event) => handleCompareBudgetChange(event.target.value)}
                onBlur={handleCompareBudgetBlur}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <Button
              variant="outline"
              onClick={() => setShowCompareSignalConfig((prev) => !prev)}
            >
              {showCompareSignalConfig ? "收起对比阈值" : "调整对比阈值"}
            </Button>
            <Button
              variant="outline"
              onClick={resetComparisonSignalConfig}
              title="将对比参数恢复到默认值"
            >
              恢复默认值
            </Button>
            {showCompareSignalConfig && (
              <div className="flex flex-wrap gap-2">
                {COMPARISON_SIGNAL_PRESETS.filter((preset) => preset.key !== "custom").map((preset) => (
                  <Button
                    key={preset.key}
                    variant={comparisonSignalPresetKey === preset.key ? "default" : "outline"}
                    size="sm"
                    onClick={() => applyComparisonSignalPreset(preset.key)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            )}

            {showCompareSignalConfig && (
              <div className="w-full rounded-lg border border-border/60 bg-muted/25 p-3">
                <div className="mb-2 text-xs text-muted-foreground">
                  当前档位：{comparisonSignalPresetKey === "custom" ? "自定义" : COMPARISON_SIGNAL_PRESETS.find((preset) => preset.key === comparisonSignalPresetKey)?.label ?? "自定义"}，
                  已生效参数：avg={comparisonSignalConfig.avgRatioMin.toFixed(2)}，末端=
                  {comparisonSignalConfig.lastPointRatioMin.toFixed(2)}，峰值=
                  {comparisonSignalConfig.peakRatioMin.toFixed(2)}，强势斜率=
                  {comparisonSignalConfig.risingStrongMinSlopeRatio.toFixed(2)}，near1容差=
                  {comparisonSignalConfig.nearOneTolerance.toFixed(2)}
                </div>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                  {COMPARISON_SIGNAL_CONFIG_FIELDS.map((field) => (
                    <label key={`signal-config-${field.key}`} className="space-y-1 text-xs">
                      <span className="text-foreground">{field.label}</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        className="h-8"
                        value={comparisonSignalConfigInput[field.key]}
                        onChange={(event) =>
                          handleComparisonSignalConfigInputChange(field.key, event.target.value)
                        }
                        onBlur={() => handleComparisonSignalConfigBlur()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        {field.hint}（{field.min}~{field.max}）
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {compareProgress && (
              <span className="text-xs text-muted-foreground">
                对比进度 {compareProgress.ready}/{compareProgress.total}
              </span>
            )}
          </div>

          {loadingKeywords ? (
            <div className="text-sm text-muted-foreground">正在加载关键词...</div>
          ) : keywords.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无关键词。</div>
          ) : (
            <div className="space-y-2">
              {keywords.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-md border p-3 text-sm md:flex-row md:items-center md:justify-between",
                    selectedIds.has(item.id) ? "border-primary/50 bg-primary/5" : ""
                  )}
                >
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 rounded border-zinc-300 text-primary focus:ring-ring"
                      checked={selectedIds.has(item.id)}
                      onChange={(event) => handleSelect(item.id, event.target.checked)}
                    />
                    <div className="space-y-1">
                      <div className="font-medium">{item.keyword}</div>
                      <div className="text-xs text-muted-foreground break-all">{item.url}</div>
                      <div className="text-[10px] text-muted-foreground">{item.sourceName ?? item.sitemapUrl}</div>
                    </div>
                  </label>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {getStatusLabel(item.status)}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{formatUtcDateTime(item.extractedAt)}</span>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
                <span>
                  共{keywordsTotal}条，当前第{keywordsPage}页
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={keywordsPage <= 1}
                    onClick={() => setKeywordsPage((prev) => Math.max(1, prev - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={keywordsPage * keywordsLimit >= keywordsTotal}
                    onClick={() => setKeywordsPage((prev) => prev + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {compareData && <ComparisonResultsCard compareData={compareData} showDetails />}
    </div>
  );
}


