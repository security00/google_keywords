"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    fetchByokPipelineJob,
    pickResumablePipelineJobs,
    pollByokPipelineJob,
    type ByokPipelineHistoryItem,
    type ByokPipelineJob,
} from "@/lib/client/byok-pipeline-resume";
import { pollTaskUntilComplete } from "@/lib/client/task-poller";
import {
    ExpandResponse,
    CompareResponse,
    AuthUser,
    ComparisonExplanation,
    ComparisonFreshness,
    ComparisonIntent,
    ComparisonResult,
    ComparisonSeries,
    FilterSummary,
} from "@/lib/types";
import sharedKeywordDefaults from "@/config/shared-keyword-defaults.json";
import { scoreKeyword } from "@/lib/rule-engine";

// --- Local Types from original component ---
export type LogLevel = "info" | "success" | "error";
export type LogEntry = {
    id: string;
    at: string;
    level: LogLevel;
    title: string;
    details?: string;
};

type SessionSummary = {
    id: string;
    title: string | null;
    keywords: string[];
    date_from: string | null;
    date_to: string | null;
    benchmark: string | null;
    created_at: string | null;
};

type ResearchExecutionMode = "shared" | "byok";
type PipelineJobResult<T> = ByokPipelineJob<T>;

// --- Constants ---
export const DEFAULT_KEYWORDS = [
    ...sharedKeywordDefaults.defaultKeywords,
];
export const DEFAULT_BENCHMARK = process.env.NEXT_PUBLIC_BENCHMARK_KEYWORD ?? "gpts";
export const DEFAULT_FILTER_TERMS = process.env.NEXT_PUBLIC_FILTER_TERMS ??
    "gambling,betting,casino,news,celebrity,movie,film,lottery,gold,gold price,stock market,stock trading,stock price,stocks,equity,equities,futures,futures market,futures trading,login,log in,log-in,signin,sign in,sign-in,signup,sign up,sign-up,register,registration,portal,ice agent,cartel,ambush,ambushed,博彩,赌博,赌场,投注,新闻,名人,电影,黄金,金价,股市,股票,证券,期货,期货交易,期货市场,交易市场,登录,登陆,注册,门户,门户网站,ice特工";
export const TASK_COST_USD = 0.05;
const CLIENT_MAX_WAIT_MS = Number(process.env.NEXT_PUBLIC_TASK_MAX_WAIT_MS) || 600000;
const CLIENT_POLL_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_TASK_POLL_INTERVAL_MS) || 5000;
import { RECOMMENDED_COMPARE_LIMIT } from "@/config/business-rules";
const RECOMMENDED_MIN_SCORE = 20;
const RECOMMENDED_HIGH_CONFIDENCE_SCORE = 60;
const RECOMMENDED_SECTION_QUOTAS = {
    explosive: 22,
    fastRising: 16,
    steadyRising: 12,
};

// --- Helper Functions ---
export const formatUsd = (value: number) => `$${value.toFixed(2)}`;
export const countEstimate = (count: number) => Math.ceil(count / 4) * TASK_COST_USD;
export const parseKeywords = (input: string) => {
    const cleaned = input
        .replace(/,/g, " ")
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const keyword of cleaned) {
        const key = keyword.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(keyword);
        }
    }
    return result;
};

export const organizeCandidates = (candidates: ExpandResponse["candidates"]) => {
    const risingCandidates = candidates.filter((candidate) => candidate.type === "rising");
    const seen = new Map<string, (typeof risingCandidates)[number]>();

    for (const candidate of risingCandidates) {
        const key = candidate.keyword.toLowerCase();
        const existing = seen.get(key);
        if (!existing || candidate.value > existing.value) {
            seen.set(key, candidate);
        }
    }

    const uniqueCandidates = Array.from(seen.values());
    const sortedCandidates = uniqueCandidates.sort((a, b) => {
        const scoreDiff = Number(b.score ?? 0) - Number(a.score ?? 0);
        if (scoreDiff !== 0) return scoreDiff;
        return b.value - a.value;
    });

    const organized = {
        explosive: [] as typeof candidates,
        fastRising: [] as typeof candidates,
        steadyRising: [] as typeof candidates,
        slowRising: [] as typeof candidates,
    };

    for (const candidate of sortedCandidates) {
        if (candidate.value > 500) {
            organized.explosive.push(candidate);
        } else if (candidate.value > 200) {
            organized.fastRising.push(candidate);
        } else if (candidate.value > 100) {
            organized.steadyRising.push(candidate);
        } else {
            organized.slowRising.push(candidate);
        }
    }
    return organized;
};

export const buildRecommendedSelection = (
    expandData: Pick<ExpandResponse, "organized" | "flatList"> | null,
    limit = RECOMMENDED_COMPARE_LIMIT,
    userId?: string | null
) => {
    if (!expandData) return [];

    const picked = new Set<string>();
    const isEligible = (item: ExpandResponse["candidates"][number]) => {
        const latestRule = scoreKeyword(item.keyword);
        return latestRule.action !== "block" && Number(latestRule.score) >= RECOMMENDED_MIN_SCORE;
    };
    const addCandidates = (items: ExpandResponse["candidates"], maxCount: number) => {
        let added = 0;
        for (const item of items) {
            if (picked.size >= limit || added >= maxCount) break;
            if (isEligible(item)) {
                const before = picked.size;
                picked.add(item.keyword);
                if (picked.size > before) added += 1;
            }
        }
    };

    const strongCandidates = expandData.flatList.filter(
        (item) => isEligible(item) && Number(item.score ?? 0) >= RECOMMENDED_HIGH_CONFIDENCE_SCORE
    );
    for (const item of strongCandidates) {
        if (picked.size >= limit) break;
        picked.add(item.keyword);
    }

    const sectionTargets = [
        {
            items: expandData.organized.explosive,
            maxCount: RECOMMENDED_SECTION_QUOTAS.explosive,
        },
        {
            items: expandData.organized.fastRising,
            maxCount: RECOMMENDED_SECTION_QUOTAS.fastRising,
        },
        {
            items: expandData.organized.steadyRising,
            maxCount: RECOMMENDED_SECTION_QUOTAS.steadyRising,
        },
    ];

    for (const section of sectionTargets) {
        addCandidates(section.items, section.maxCount);
    }

    if (picked.size < limit) {
        addCandidates(
            expandData.flatList.filter((item) => !expandData.organized.slowRising.includes(item)),
            limit
        );
    }

    const allPicked = Array.from(picked);

    // Per-user personalization: pick a deterministic subset based on userId
    if (userId && allPicked.length > 2) {
        let h = 0;
        for (let i = 0; i < userId.length; i++) {
            h = ((h << 5) - h + userId.charCodeAt(i)) | 0;
        }
        h = Math.abs(h);
        const result: string[] = [];
        for (let i = 0; i < 2 && i < allPicked.length; i++) {
            result.push(allPicked[(h + i * 7) % allPicked.length]);
        }
        return result;
    }

    return allPicked;
};

const DEFAULT_SUMMARY: CompareResponse["summary"] = {
    strong: 0,
    pass: 0,
    close: 0,
    watch: 0,
    fail: 0,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const toStringArray = (value: unknown) =>
    Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];

const parseNumber = (value: unknown, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
};

const parseVerdict = (value: unknown): ComparisonResult["verdict"] => {
    if (value === "strong" || value === "pass" || value === "close" || value === "watch" || value === "fail") {
        return value;
    }
    return "fail";
};

const parseFilterSummary = (value: unknown): FilterSummary | undefined => {
    if (!isRecord(value)) return undefined;
    const enabled = value.enabled === true;
    return {
        enabled,
        model: typeof value.model === "string" ? value.model : undefined,
        total: parseNumber(value.total),
        removed: parseNumber(value.removed),
        kept: parseNumber(value.kept),
        skippedReason: typeof value.skippedReason === "string" ? value.skippedReason : undefined,
    };
};

const parseComparisonSummary = (value: unknown): CompareResponse["summary"] => {
    if (!isRecord(value)) return DEFAULT_SUMMARY;
    return {
        strong: parseNumber(value.strong),
        pass: parseNumber(value.pass),
        close: parseNumber(value.close),
        watch: parseNumber(value.watch),
        fail: parseNumber(value.fail),
    };
};

// --- Context Interface ---
interface ResearchContextType {
    user: AuthUser | null;

    // Inputs
    keywordsText: string;
    setKeywordsText: React.Dispatch<React.SetStateAction<string>>;
    useCache: boolean;
    setUseCache: React.Dispatch<React.SetStateAction<boolean>>;
    useModelFilter: boolean;
    setUseModelFilter: React.Dispatch<React.SetStateAction<boolean>>;
    includeTop: boolean;
    setIncludeTop: React.Dispatch<React.SetStateAction<boolean>>;
    filterTermsText: string;
    setFilterTermsText: React.Dispatch<React.SetStateAction<string>>;
    filterPrompt: string;
    setFilterPrompt: React.Dispatch<React.SetStateAction<string>>;

    // Data State
    expandData: ExpandResponse | null;
    selected: Set<string>;
    setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
    compareData: CompareResponse | null;

    // Loading & logs
    loadingExpand: boolean;
    loadingCompare: boolean;
    expandProgress: TaskProgress | null;
    compareProgress: TaskProgress | null;
    error: string | null;
    debugLogs: LogEntry[];
    setDebugLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>;
    logToConsole: boolean;
    setLogToConsole: React.Dispatch<React.SetStateAction<boolean>>;
    pushLog: (level: LogLevel, title: string, details?: string) => void;

    // Sessions
    sessionList: SessionSummary[];
    loadSessionList: () => Promise<void>;
    loadSessionById: (id: string) => Promise<void>;

    // IDs
    sessionId: string | null;
    comparisonId: string | null;

    executionMode: ResearchExecutionMode;
    setExecutionMode: (mode: ResearchExecutionMode) => Promise<void>;
    byokReady: boolean;

    // Actions
    handleExpand: () => Promise<void>;
    handleCompare: () => Promise<void>;
    toggleCandidate: (keyword: string) => void;
    selectAll: () => void;
    selectTop: (count: number) => void;
    selectRecommended: () => void;
    clearSelection: () => void;
    loadLatestSession: () => Promise<void>;
    handleSignOut: () => Promise<void>;

    // Computed
    effectiveKeywords: string[];
}

const ResearchContext = createContext<ResearchContextType | undefined>(undefined);

type TaskProgress = {
    ready: number;
    total: number;
};

export function ResearchProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();

    // Global 401 interceptor: redirect to login when session expires
    useEffect(() => {
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const response = await originalFetch(...args);
            if (
                (response.status === 401 || response.status === 403) &&
                window.location.pathname.startsWith("/dashboard")
            ) {
                // Check if it's a session expiry (not just admin-only endpoint)
                try {
                    const cloned = response.clone();
                    const body = await cloned.json();
                    if (body.error === "Unauthorized" || body.error === "No session") {
                        router.replace("/login");
                    }
                } catch {
                    if (response.status === 401) router.replace("/login");
                }
            }
            return response;
        };
        return () => { window.fetch = originalFetch; };
    }, [router]);

    // --- State Variables ---
    const [keywordsText, setKeywordsText] = useState("");
    const [useCache, setUseCache] = useState(true);
    const [useModelFilter, setUseModelFilter] = useState(true);
    const [includeTop, setIncludeTop] = useState(false);
    const [filterTermsText, setFilterTermsText] = useState<string>(DEFAULT_FILTER_TERMS);
    const [filterPrompt, setFilterPrompt] = useState("");

    const [expandData, setExpandData] = useState<ExpandResponse | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [compareData, setCompareData] = useState<CompareResponse | null>(null);

    const [loadingExpand, setLoadingExpand] = useState(false);
    const [loadingCompare, setLoadingCompare] = useState(false);
    const [expandProgress, setExpandProgress] = useState<TaskProgress | null>(null);
    const [compareProgress, setCompareProgress] = useState<TaskProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [debugLogs, setDebugLogs] = useState<LogEntry[]>([]);
    const [logToConsole, setLogToConsole] = useState(true);

    const [user, setUser] = useState<AuthUser | null>(null);
    const [authReady, setAuthReady] = useState(false);
    const [sessionList, setSessionList] = useState<SessionSummary[]>([]);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [comparisonId, setComparisonId] = useState<string | null>(null);
    const [executionMode, setExecutionModeState] = useState<ResearchExecutionMode>("shared");
    const [byokReady, setByokReady] = useState(false);
    const pipelineWatchGeneration = useRef(0);
    const expandDataRef = useRef<ExpandResponse | null>(null);
    const compareDataRef = useRef<CompareResponse | null>(null);
    const loadingExpandRef = useRef(false);
    const loadingCompareRef = useRef(false);

    // --- Computed ---
    const parsedKeywords = useMemo(() => parseKeywords(keywordsText), [keywordsText]);
    const parsedFilterTerms = useMemo(() =>
        filterTermsText.split(/[,;\n]+/).map(i => i.trim()).filter(Boolean),
        [filterTermsText]);
    const effectiveKeywords = parsedKeywords.length > 0 ? parsedKeywords : DEFAULT_KEYWORDS;

    useEffect(() => {
        expandDataRef.current = expandData;
    }, [expandData]);
    useEffect(() => {
        compareDataRef.current = compareData;
    }, [compareData]);
    useEffect(() => {
        loadingExpandRef.current = loadingExpand;
    }, [loadingExpand]);
    useEffect(() => {
        loadingCompareRef.current = loadingCompare;
    }, [loadingCompare]);

    const checkSession = useCallback(async () => {
        try {
            const response = await fetch("/api/auth/session", {
                credentials: "include",
                cache: "no-store",
            });
            const payload = await response.json();
            setUser(payload?.user ?? null);
        } catch {
            setUser(null);
        } finally {
            setAuthReady(true);
        }
    }, []);

    // --- Auth Check ---
    useEffect(() => {
        checkSession();
    }, [checkSession]);

    useEffect(() => {
        const refreshWhenVisible = () => {
            if (document.visibilityState === "visible") {
                checkSession();
            }
        };
        window.addEventListener("focus", checkSession);
        document.addEventListener("visibilitychange", refreshWhenVisible);
        return () => {
            window.removeEventListener("focus", checkSession);
            document.removeEventListener("visibilitychange", refreshWhenVisible);
        };
    }, [checkSession]);

    useEffect(() => {
        if (authReady && !user) {
            router.replace("/login");
        }
    }, [authReady, user, router]);

    const applySessionPayload = useCallback((payload: unknown) => {
        if (!isRecord(payload) || !isRecord(payload.session)) return false;

        const session = payload.session;
        const restoredSessionId = typeof session.id === "string" ? session.id : null;
        if (!restoredSessionId) return false;

        const parsedCandidates = Array.isArray(payload.candidates)
            ? payload.candidates
                .filter(isRecord)
                .map((item) => {
                    const keyword = typeof item.keyword === "string" ? item.keyword : "";
                    if (!keyword) return null;
                    return {
                        keyword,
                        value: parseNumber(item.value),
                        type: item.type === "top" ? "top" : "rising",
                        source: typeof item.source === "string" ? item.source : "",
                        score: parseNumber(item.score),
                        filtered: item.filtered === true,
                    };
                })
                .filter((item): item is {
                    keyword: string;
                    value: number;
                    type: "top" | "rising";
                    source: string;
                    score: number;
                    filtered: boolean;
                } => Boolean(item))
            : [];

        const unfiltered = parsedCandidates
            .filter((item) => !item.filtered)
            .map((item) => ({
                keyword: item.keyword,
                value: item.value,
                type: item.type,
                source: item.source,
                score: item.score,
            }));

        const filteredOut = parsedCandidates
            .filter((item) => item.filtered)
            .map((item) => ({
                keyword: item.keyword,
                value: item.value,
                type: item.type,
                source: item.source,
                score: item.score,
            }));

        const organized = organizeCandidates(unfiltered);
        const flatList = [
            ...organized.explosive, ...organized.fastRising,
            ...organized.steadyRising, ...organized.slowRising
        ];

        const sessionData: ExpandResponse = {
            keywords: toStringArray(session.keywords),
            dateFrom: typeof session.date_from === "string" ? session.date_from : "",
            dateTo: typeof session.date_to === "string" ? session.date_to : "",
            candidates: unfiltered,
            organized,
            flatList,
            fromCache: false,
            filter: parseFilterSummary(session.filter_summary),
            filteredOut,
            sessionId: restoredSessionId,
        };

        setExpandData(sessionData);
        setSelected(new Set(buildRecommendedSelection(sessionData)));
        setSessionId(restoredSessionId);

        const comparison = isRecord(payload.comparison) ? payload.comparison : null;
        if (comparison) {
            const compareResults = Array.isArray(payload.comparisonResults)
                ? payload.comparisonResults
                    .filter(isRecord)
                    .map((item) => {
                        const keyword = typeof item.keyword === "string" ? item.keyword : "";
                        if (!keyword) return null;
                        const series = isRecord(item.trend_series)
                            ? (item.trend_series as ComparisonSeries)
                            : isRecord(item.series)
                                ? (item.series as ComparisonSeries)
                                : undefined;
                        const explanation = isRecord(item.explanation)
                            ? (item.explanation as ComparisonExplanation)
                            : undefined;
                        const intent = isRecord(item.intent)
                            ? (item.intent as ComparisonIntent)
                            : undefined;
                        const freshness = isRecord(item.freshness)
                            ? (item.freshness as ComparisonFreshness)
                            : undefined;
                        const parsed: CompareResponse["results"][number] = {
                            keyword,
                            avgValue: parseNumber(item.avg_value),
                            benchmarkValue: parseNumber(item.benchmark_value),
                            ratio: parseNumber(item.ratio),
                            ratioMean: parseNumber(item.ratio_mean),
                            ratioRecent: parseNumber(item.ratio_recent),
                            ratioCoverage: parseNumber(item.ratio_coverage),
                            ratioPeak: parseNumber(item.ratio_peak),
                            ratioLastPoint: parseNumber(
                              (item as { ratio_last_point?: unknown; ratioLastPoint?: unknown })
                                .ratio_last_point ?? (item as { ratioLastPoint?: unknown }).ratioLastPoint
                            ),
                            slopeDiff: parseNumber(item.slope_diff),
                            slopeRatio: parseNumber(
                              (item as { slope_ratio?: unknown; slopeRatio?: unknown }).slope_ratio ??
                                (item as { slopeRatio?: unknown }).slopeRatio
                            ),
                            volatility: parseNumber(item.volatility),
                            crossings: parseNumber(item.crossings),
                            verdict: parseVerdict(item.verdict),
                        };
                        if (series) parsed.series = series;
                        if (explanation) parsed.explanation = explanation;
                        if (intent) parsed.intent = intent;
                        if (freshness) parsed.freshness = freshness;
                        return parsed;
                    })
                    .filter((item): item is CompareResponse["results"][number] => item !== null)
                : [];

            const restoredComparisonId =
                typeof comparison.id === "string" ? comparison.id : undefined;

            setCompareData({
                benchmark:
                    typeof comparison.benchmark === "string" && comparison.benchmark.trim()
                        ? comparison.benchmark
                        : DEFAULT_BENCHMARK,
                dateFrom: typeof comparison.date_from === "string" ? comparison.date_from : "",
                dateTo: typeof comparison.date_to === "string" ? comparison.date_to : "",
                results: compareResults,
                summary: parseComparisonSummary(comparison.summary),
                comparisonId: restoredComparisonId,
                sessionId: restoredSessionId,
            });
            setComparisonId(restoredComparisonId ?? null);
        } else {
            setCompareData(null);
            setComparisonId(null);
        }

        return true;
    }, []);

    const loadSessionList = useCallback(async () => {
        try {
            const response = await fetch("/api/research/session/list", {
                credentials: "include",
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || "加载会话列表失败");
            setSessionList(payload?.sessions ?? []);
        } catch (err) {
            setSessionList([]);
            if (err instanceof Error) {
                console.log("[keyword-research] loadSessionList failed", err.message);
            }
        }
    }, []);

    // --- Actions ---
    const pushLog = useCallback((level: LogLevel, title: string, details?: string) => {
        const entry: LogEntry = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            at: new Date().toLocaleTimeString(),
            level,
            title,
            details,
        };
        setDebugLogs((prev) => [entry, ...prev].slice(0, 200));
        if (logToConsole) {
            const method = level === "error" ? "error" : level === "success" ? "info" : "log";
            console[method](`[keyword-research] ${title}`, details ?? "");
        }
    }, [logToConsole]);

    const handleSignOut = async () => {
        await fetch("/api/auth/sign-out", {
            method: "POST",
            credentials: "include",
        });
        setUser(null);
        router.push("/login");
    };

    const loadSessionById = useCallback(async (id: string) => {
        try {
            const response = await fetch(`/api/research/session/${id}`, {
                credentials: "include",
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || "加载会话失败");
            if (!applySessionPayload(payload)) return;
            pushLog("success", "已恢复会话", id);
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载失败");
        }
    }, [applySessionPayload, pushLog]);

    const loadLatestSession = useCallback(async () => {
        try {
            const response = await fetch("/api/research/session/latest", {
                credentials: "include",
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || "加载会话失败");
            if (!applySessionPayload(payload)) return;
            pushLog("success", "已恢复上次会话", payload.session.id);
        } catch (err) {
            setError(err instanceof Error ? err.message : "加载失败");
        }
    }, [applySessionPayload, pushLog]);

    // Initial load
    useEffect(() => {
        if (!user) {
            setSessionList([]);
        } else {
            loadSessionList();
        }
    }, [user, loadSessionList]);

    useEffect(() => {
        if (!user) return;
        Promise.all([
            fetch("/api/research/preferences", { credentials: "include", cache: "no-store" }),
            fetch("/api/research/byok/readiness", { credentials: "include", cache: "no-store" }),
        ]).then(async ([preferenceResponse, readinessResponse]) => {
            const preference = preferenceResponse.ok ? await preferenceResponse.json() : {};
            const readiness = readinessResponse.ok ? await readinessResponse.json() : {};
            setByokReady(readiness.ready === true);
            setExecutionModeState(preference.executionMode === "byok" && readiness.ready === true ? "byok" : "shared");
        }).catch(() => {
            setByokReady(false);
            setExecutionModeState("shared");
        });
    }, [user]);

    const setExecutionMode = useCallback(async (mode: ResearchExecutionMode) => {
        if (mode === "byok" && !byokReady) {
            setError("请先在账号设置中保存并验证 DataForSEO 与 OpenRouter 凭证");
            return;
        }
        const response = await fetch("/api/research/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ executionMode: mode }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            setError(body?.error || "无法保存研究模式");
            return;
        }
        setExecutionModeState(mode);
        setError(null);
    }, [byokReady]);

    const runByokPipeline = useCallback(async <T,>(
        operation: "expand" | "compare",
        body: Record<string, unknown>,
        onProgress: (progress: { completed: number; total: number }) => void,
    ): Promise<T> => {
        type PipelineQuote = {
            quoteId: string; requestHash: string; estimatedCostUsd: number;
            expiresAt: string; batchCount: number;
        };
        const executeQuote = async (quote: PipelineQuote, executeKey: string) => {
            const response = await fetch(`/api/research/byok/pipeline/${operation}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Idempotency-Key": executeKey },
                credentials: "include",
                body: JSON.stringify({
                    quoteId: quote.quoteId,
                    requestHash: quote.requestHash,
                    confirmedEstimatedCostUsd: quote.estimatedCostUsd,
                }),
            });
            const job = await response.json().catch(() => ({})) as PipelineJobResult<T>;
            if (!response.ok) throw new Error((job as { code?: string }).code || "实时请求启动失败");
            return job;
        };
        const pollJob = (initial: PipelineJobResult<T>) =>
            pollByokPipelineJob(initial, {
                onProgress,
                maxWaitMs: CLIENT_MAX_WAIT_MS,
                pollIntervalMs: CLIENT_POLL_INTERVAL_MS,
            });
        const quoteKey = `${operation}-${crypto.randomUUID()}`;
        const quoteResponse = await fetch(`/api/research/byok/pipeline/${operation}/quote`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": quoteKey },
            credentials: "include",
            body: JSON.stringify(body),
        });
        const quoted = await quoteResponse.json().catch(() => ({}));
        if (!quoteResponse.ok) throw new Error(quoted?.code || quoted?.error || "无法生成实时费用报价");
        const quote = quoted.quote as PipelineQuote;
        const confirmed = window.confirm(
            `本次实时${operation === "expand" ? "扩词" : "对比"}将使用你的 Provider 额度。\n`
            + `保守费用上限：$${quote.estimatedCostUsd.toFixed(3)}\n`
            + `内部批次：${quote.batchCount}\n\n确认继续？`,
        );
        if (!confirmed) throw new Error("已取消实时请求");
        let job = await pollJob(await executeQuote(quote, `execute-${quoteKey}`));
        if (job.status === "failed") throw new Error(job.errorCode || "实时任务失败");
        if (!job.result) throw new Error("实时任务等待超时");
        if (job.status === "partial") {
            const retryKey = `retry-${operation}-${crypto.randomUUID()}`;
            const retryResponse = await fetch(
                `/api/research/byok/pipeline/jobs/${encodeURIComponent(job.jobId)}/retry/quote`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Idempotency-Key": retryKey },
                    credentials: "include",
                    body: "{}",
                },
            );
            const retryBody = await retryResponse.json().catch(() => ({}));
            if (retryResponse.ok) {
                const retryQuote = retryBody.quote as PipelineQuote;
                const retryConfirmed = window.confirm(
                    `部分阶段未完成。是否只重试失败阶段？\n`
                    + `追加费用上限：$${retryQuote.estimatedCostUsd.toFixed(3)}\n`
                    + `重试批次：${retryQuote.batchCount}\n\n已成功阶段不会再次调用 Provider。`,
                );
                if (retryConfirmed) {
                    const retried = await pollJob(await executeQuote(retryQuote, `execute-${retryKey}`));
                    if (retried.result) job = retried;
                }
            } else if (retryBody?.code !== "NO_RETRYABLE_STEPS") {
                window.alert(`部分结果已保留，但失败阶段暂时无法重新报价：${retryBody?.code || "RETRY_UNAVAILABLE"}`);
            }
        }
        return job.result as T;
    }, []);

    useEffect(() => {
        if (!user || !byokReady) return;
        const generation = pipelineWatchGeneration.current;
        let cancelled = false;
        const stillCurrent = () => !cancelled && generation === pipelineWatchGeneration.current;

        const applyExpand = (payload: ExpandResponse) => {
            setExpandData(payload);
            setSelected(new Set(buildRecommendedSelection(payload)));
            setSessionId(payload.sessionId ?? null);
            if (payload.keywords.length > 0) {
                setKeywordsText(payload.keywords.join("\n"));
            }
        };
        const applyCompare = (payload: CompareResponse) => {
            setCompareData(payload);
            setComparisonId(payload.comparisonId ?? null);
        };

        const resume = async () => {
            const historyResponse = await fetch("/api/research/byok/pipeline/history?limit=20", {
                credentials: "include",
                cache: "no-store",
            });
            if (!historyResponse.ok || !stillCurrent()) return;
            const history = await historyResponse.json().catch(() => ({}));
            const picked = pickResumablePipelineJobs(
                (history.items ?? []) as ByokPipelineHistoryItem[],
            );

            if (picked.expand && !expandDataRef.current && !loadingExpandRef.current && stillCurrent()) {
                const job = await fetchByokPipelineJob<ExpandResponse>(picked.expand.jobId);
                if (!stillCurrent()) return;
                if (job.status === "processing") {
                    setLoadingExpand(true);
                    setExpandProgress({ ready: job.progress.completed, total: job.progress.total });
                    pushLog("info", "已接上后台扩词任务", `${job.progress.completed}/${job.progress.total}`);
                    const done = await pollByokPipelineJob(job, {
                        onProgress: (progress) => {
                            if (stillCurrent()) {
                                setExpandProgress({ ready: progress.completed, total: progress.total });
                            }
                        },
                        shouldStop: () => !stillCurrent(),
                        maxWaitMs: CLIENT_MAX_WAIT_MS,
                        pollIntervalMs: CLIENT_POLL_INTERVAL_MS,
                    });
                    if (!stillCurrent()) return;
                    if (done.result) {
                        applyExpand(done.result);
                        pushLog("success", "已恢复后台扩词结果", done.jobId);
                    } else if (done.status === "failed") {
                        setError(done.errorCode || "后台扩词失败");
                    }
                    setLoadingExpand(false);
                    setExpandProgress(null);
                } else if (job.result) {
                    applyExpand(job.result);
                    pushLog("success", "已恢复上次扩词结果", job.jobId);
                }
            }

            if (picked.compare && !compareDataRef.current && !loadingCompareRef.current && stillCurrent()) {
                const job = await fetchByokPipelineJob<CompareResponse>(picked.compare.jobId);
                if (!stillCurrent()) return;
                if (job.status === "processing") {
                    setLoadingCompare(true);
                    setCompareProgress({ ready: job.progress.completed, total: job.progress.total });
                    pushLog("info", "已接上后台对比任务", `${job.progress.completed}/${job.progress.total}`);
                    const done = await pollByokPipelineJob(job, {
                        onProgress: (progress) => {
                            if (stillCurrent()) {
                                setCompareProgress({ ready: progress.completed, total: progress.total });
                            }
                        },
                        shouldStop: () => !stillCurrent(),
                        maxWaitMs: CLIENT_MAX_WAIT_MS,
                        pollIntervalMs: CLIENT_POLL_INTERVAL_MS,
                    });
                    if (!stillCurrent()) return;
                    if (done.result) {
                        applyCompare(done.result);
                        pushLog("success", "已恢复后台对比结果", done.jobId);
                    } else if (done.status === "failed") {
                        setError(done.errorCode || "后台对比失败");
                    }
                    setLoadingCompare(false);
                    setCompareProgress(null);
                } else if (job.result) {
                    applyCompare(job.result);
                    pushLog("success", "已恢复上次对比结果", job.jobId);
                }
            }
        };

        void resume().catch((error) => {
            if (stillCurrent()) {
                pushLog("error", "无法接上后台任务", error instanceof Error ? error.message : "未知错误");
            }
        });

        return () => {
            cancelled = true;
        };
    }, [user, byokReady, pushLog]);

    const handleExpand = async () => {
        pipelineWatchGeneration.current += 1;
        setLoadingExpand(true);
        setError(null);
        setCompareData(null);
        setExpandProgress({ ready: 0, total: 0 });
        const startedAt = performance.now();
        pushLog("info", "扩展请求已发送", `keywords=${effectiveKeywords.length}`);

        try {
            if (executionMode === "byok") {
                const completedPayload = await runByokPipeline<ExpandResponse>("expand", {
                    keywords: effectiveKeywords,
                    days: 90,
                    filterTerms: parsedFilterTerms,
                    filterPrompt,
                }, (progress) => setExpandProgress({ ready: progress.completed, total: progress.total }));
                setExpandData(completedPayload);
                setSelected(new Set(buildRecommendedSelection(completedPayload)));
                setSessionId(completedPayload.sessionId ?? null);
                pushLog("success", "实时扩展完成", `耗时=${Math.round(performance.now() - startedAt)}ms`);
                router.push("/dashboard/candidates");
                return;
            }
            const response = await fetch("/api/research/expand", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    keywords: effectiveKeywords,
                    useCache: true,
                    useFilter: true,
                    includeTop: false,
                    filterTerms: parsedFilterTerms,
                    filterPrompt,
                    responseLimit: 250,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || "请求失败");

            if (payload?.jobId) {
                const jobId = payload.jobId as string;
                const completedPayload = await pollTaskUntilComplete<ExpandResponse>({
                    jobId,
                    statusUrl: "/api/research/expand/status",
                    maxWaitMs: CLIENT_MAX_WAIT_MS,
                    pollIntervalMs: CLIENT_POLL_INTERVAL_MS,
                    onPending: (pollPayload) => {
                        if (pollPayload?.ready !== undefined && pollPayload?.total !== undefined) {
                            setExpandProgress({
                                ready: Number(pollPayload.ready ?? 0),
                                total: Number(pollPayload.total ?? 0),
                            });
                            pushLog(
                                "info",
                                "任务处理中",
                                `${pollPayload.ready}/${pollPayload.total}`
                            );
                        }
                    },
                });
                if (!completedPayload) {
                    throw new Error("任务等待超时");
                }

                if (completedPayload?.ready !== undefined && completedPayload?.total !== undefined) {
                    setExpandProgress({
                        ready: Number(completedPayload.ready ?? 0),
                        total: Number(completedPayload.total ?? 0),
                    });
                }

                setExpandData(completedPayload);
                setSelected(new Set(buildRecommendedSelection(completedPayload)));
                setSessionId(completedPayload.sessionId ?? null);

                pushLog("success", "扩展请求完成", `耗时=${Math.round(performance.now() - startedAt)}ms`);
                router.push("/dashboard/candidates");
                return;
            }

            setExpandData(payload as ExpandResponse);
            setSelected(new Set(buildRecommendedSelection(payload as ExpandResponse)));
            setSessionId((payload as ExpandResponse).sessionId ?? null);

            pushLog("success", "扩展请求完成", `耗时=${Math.round(performance.now() - startedAt)}ms`);
            router.push("/dashboard/candidates"); // Auto navigate to next step
        } catch (err) {
            setError(err instanceof Error ? err.message : "请求失败");
            pushLog("error", "扩展请求异常", err instanceof Error ? err.message : "未知错误");
        } finally {
            setLoadingExpand(false);
            setExpandProgress(null);
        }
    };

    const handleCompare = async () => {
        if (selected.size === 0) return;
        pipelineWatchGeneration.current += 1;
        setLoadingCompare(true);
        setError(null);
        setCompareProgress({ ready: 0, total: 0 });
        const startedAt = performance.now();
        pushLog("info", "对比请求已发送", `selected=${selected.size}`);

        try {
            if (executionMode === "byok") {
                const completedPayload = await runByokPipeline<CompareResponse>("compare", {
                    keywords: Array.from(selected),
                    benchmark: DEFAULT_BENCHMARK,
                    ...(expandData?.dateFrom && expandData?.dateTo
                        ? { dateFrom: expandData.dateFrom, dateTo: expandData.dateTo }
                        : { days: 90 }),
                }, (progress) => setCompareProgress({ ready: progress.completed, total: progress.total }));
                setCompareData(completedPayload);
                setComparisonId(completedPayload.comparisonId ?? null);
                pushLog("success", "实时对比完成", `耗时=${Math.round(performance.now() - startedAt)}ms`);
                router.push("/dashboard/analysis");
                return;
            }
            const response = await fetch("/api/research/compare", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    keywords: Array.from(selected),
                    dateFrom: expandData?.dateFrom,
                    dateTo: expandData?.dateTo,
                    benchmark: DEFAULT_BENCHMARK,
                    sessionId,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || "请求失败");

            if (payload?.jobId) {
                const jobId = payload.jobId as string;
                const completedPayload = await pollTaskUntilComplete<CompareResponse>({
                    jobId,
                    statusUrl: "/api/research/compare/status",
                    maxWaitMs: CLIENT_MAX_WAIT_MS,
                    pollIntervalMs: CLIENT_POLL_INTERVAL_MS,
                    throwOnTimeout: false,
                    onPending: (pollPayload) => {
                        if (pollPayload?.ready !== undefined && pollPayload?.total !== undefined) {
                            setCompareProgress({
                                ready: Number(pollPayload.ready ?? 0),
                                total: Number(pollPayload.total ?? 0),
                            });
                            pushLog(
                                "info",
                                "任务处理中",
                                `${pollPayload.ready}/${pollPayload.total}`
                            );
                        }
                    },
                });
                if (!completedPayload) {
                    throw new Error("趋势对比仍在后台处理，请稍后再次点击开始趋势对比查看结果");
                }

                if (completedPayload?.ready !== undefined && completedPayload?.total !== undefined) {
                    setCompareProgress({
                        ready: Number(completedPayload.ready ?? 0),
                        total: Number(completedPayload.total ?? 0),
                    });
                }

                setCompareData(completedPayload);
                setComparisonId(completedPayload.comparisonId ?? null);
                pushLog("success", "对比请求完成", `耗时=${Math.round(performance.now() - startedAt)}ms`);
                router.push("/dashboard/analysis");
                return;
            }

            setCompareData(payload as CompareResponse);
            setComparisonId(payload.comparisonId ?? null);
            pushLog("success", "对比请求完成", `耗时=${Math.round(performance.now() - startedAt)}ms`);
            router.push("/dashboard/analysis"); // Auto navigate
        } catch (err) {
            setError(err instanceof Error ? err.message : "请求失败");
            pushLog("error", "对比请求异常", err instanceof Error ? err.message : "未知错误");
        } finally {
            setLoadingCompare(false);
            setCompareProgress(null);
        }
    };

    const toggleCandidate = (keyword: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(keyword)) next.delete(keyword);
            else next.add(keyword);
            return next;
        });
    };

    const selectAll = () => {
        if (!expandData) return;
        setSelected(new Set(expandData.flatList.map((item) => item.keyword)));
    };

    const selectTop = (count: number) => {
        if (!expandData) return;
        const top = expandData.flatList.slice(0, count).map((item) => item.keyword);
        setSelected(new Set(top));
    };

    const selectRecommended = () => {
        if (!expandData) return;
        setSelected(new Set(buildRecommendedSelection(expandData)));
    };

    const clearSelection = () => setSelected(new Set());

    return (
        <ResearchContext.Provider
            value={{
                user,
                keywordsText, setKeywordsText,
                useCache, setUseCache,
                useModelFilter, setUseModelFilter,
                includeTop, setIncludeTop,
                filterTermsText, setFilterTermsText,
                filterPrompt, setFilterPrompt,
                expandData,
                selected, setSelected,
                compareData,
                loadingExpand,
                loadingCompare,
                expandProgress,
                compareProgress,
                error,
                debugLogs, setDebugLogs,
                logToConsole, setLogToConsole,
                pushLog,
                sessionList,
                loadSessionList,
                loadSessionById,
                sessionId,
                comparisonId,
                executionMode,
                setExecutionMode,
                byokReady,
                handleExpand,
                handleCompare,
                toggleCandidate,
                selectAll,
                selectTop,
                selectRecommended,
                clearSelection,
                loadLatestSession,
                handleSignOut,
                effectiveKeywords
            }}
        >
            {children}
        </ResearchContext.Provider>
    );
}

export function useResearch() {
    const context = useContext(ResearchContext);
    if (context === undefined) {
        throw new Error("useResearch must be used within a ResearchProvider");
    }
    return context;
}
