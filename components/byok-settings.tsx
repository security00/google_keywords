"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Play, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Connection = {
  id: string;
  provider: "openrouter" | "dataforseo";
  label: string;
  maskedHint: string;
  credentialVersion: number;
  verificationStatus: "unverified" | "valid" | "invalid" | "error";
};
type SemanticResult = {
  keyword: string;
  decision: "keep" | "block";
  reason: string;
};
type TrendsQuote = {
  quote: {
    quoteId: string;
    estimatedCostUsd: number;
    expiresAt: string;
  };
  request: {
    keyword: string;
    benchmark: string;
    dateFrom: string;
    dateTo: string;
  };
  requestHash: string;
};
type SerpQuote = {
  quote: {
    quoteId: string;
    estimatedCostUsd: number;
    expiresAt: string;
  };
  request: { keyword: string };
  requestHash: string;
};

export function ByokSettings() {
  const [available, setAvailable] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [openRouterLabel, setOpenRouterLabel] = useState("Primary OpenRouter");
  const [apiKey, setApiKey] = useState("");
  const [dataForSeoLabel, setDataForSeoLabel] = useState("DataForSEO");
  const [dataForSeoLogin, setDataForSeoLogin] = useState("");
  const [dataForSeoPassword, setDataForSeoPassword] = useState("");
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState("1");
  const [maxConcurrentJobs, setMaxConcurrentJobs] = useState("1");
  const [spendPolicy, setSpendPolicy] = useState({
    maxDailyBudgetUsd: 10,
    maxConcurrentJobs: 2,
  });
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<SemanticResult[]>([]);
  const [trendsKeyword, setTrendsKeyword] = useState("");
  const [trendsDays, setTrendsDays] = useState("90");
  const [trendsQuote, setTrendsQuote] = useState<TrendsQuote | null>(null);
  const [trendsResult, setTrendsResult] = useState<Record<string, unknown> | null>(null);
  const [serpKeyword, setSerpKeyword] = useState("");
  const [serpQuote, setSerpQuote] = useState<SerpQuote | null>(null);
  const [serpResult, setSerpResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/provider-connections", {
      credentials: "include",
      cache: "no-store",
    });
    if (response.status === 404) {
      setAvailable(false);
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body?.error || "Unable to load BYOK connections.");
      return;
    }
    setAvailable(true);
    setLiveEnabled(body.liveModeEnabled === true);
    const current = Array.isArray(body.connections) ? body.connections : [];
    setConnections(current);
    const openRouter = current.find((item: Connection) => item.provider === "openrouter");
    const dataForSeo = current.find((item: Connection) => item.provider === "dataforseo");
    if (openRouter?.label) setOpenRouterLabel(openRouter.label);
    if (dataForSeo?.label) setDataForSeoLabel(dataForSeo.label);
    const spendResponse = await fetch("/api/provider-connections/spend-controls", {
      credentials: "include",
      cache: "no-store",
    });
    if (spendResponse.ok) {
      const spend = await spendResponse.json().catch(() => ({}));
      if (spend.controls) {
        setDailyBudgetUsd(String(spend.controls.dailyBudgetUsd));
        setMaxConcurrentJobs(String(spend.controls.maxConcurrentJobs));
      }
      if (spend.policy) setSpendPolicy(spend.policy);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const mutate = async (action: string, url: string, init: RequestInit) => {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(url, {
        ...init,
        credentials: "include",
        cache: "no-store",
      });
      const body = response.status === 204 ? { ok: true } : await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.code || body?.error || "Request failed");
      return body;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const openRouterConnection = connections.find((item) => item.provider === "openrouter") ?? null;
  const dataForSeoConnection = connections.find((item) => item.provider === "dataforseo") ?? null;

  const saveOpenRouter = async () => {
    if (!apiKey.trim()) return setMessage("Enter an OpenRouter API key.");
    const body = openRouterConnection
      ? {
          label: openRouterLabel,
          credential: { apiKey: apiKey.trim() },
          expectedCredentialVersion: openRouterConnection.credentialVersion,
        }
      : { provider: "openrouter", label: openRouterLabel, credential: { apiKey: apiKey.trim() } };
    const result = await mutate(
      "save-openrouter",
      openRouterConnection ? `/api/provider-connections/${encodeURIComponent(openRouterConnection.id)}` : "/api/provider-connections",
      {
        method: openRouterConnection ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (result) {
      setApiKey("");
      setMessage(openRouterConnection ? "OpenRouter credential rotated. Verify it before use." : "OpenRouter connection saved. Verify it before use.");
      await load();
    }
  };

  const saveDataForSeo = async () => {
    if (!dataForSeoLogin.trim() || !dataForSeoPassword) {
      return setMessage("Enter the DataForSEO login and password.");
    }
    const body = dataForSeoConnection
      ? {
          label: dataForSeoLabel,
          credential: { login: dataForSeoLogin.trim(), password: dataForSeoPassword },
          expectedCredentialVersion: dataForSeoConnection.credentialVersion,
        }
      : {
          provider: "dataforseo",
          label: dataForSeoLabel,
          credential: { login: dataForSeoLogin.trim(), password: dataForSeoPassword },
        };
    const result = await mutate(
      "save-dataforseo",
      dataForSeoConnection ? `/api/provider-connections/${encodeURIComponent(dataForSeoConnection.id)}` : "/api/provider-connections",
      {
        method: dataForSeoConnection ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (result) {
      setDataForSeoLogin("");
      setDataForSeoPassword("");
      setMessage(dataForSeoConnection ? "DataForSEO credential rotated. Verify it before use." : "DataForSEO connection saved. Verify it before use.");
      await load();
    }
  };

  const verify = async (connection: Connection) => {
    const result = await mutate(
      `verify-${connection.provider}`,
      `/api/provider-connections/${encodeURIComponent(connection.id)}/verify`,
      { method: "POST" },
    );
    if (result) {
      setMessage(result.verification?.code || "Verification finished.");
      await load();
    }
  };

  const saveSpendControls = async () => {
    const result = await mutate(
      "save-spend-controls",
      "/api/provider-connections/spend-controls",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyBudgetUsd: Number(dailyBudgetUsd),
          maxConcurrentJobs: Number(maxConcurrentJobs),
        }),
      },
    );
    if (result?.controls) {
      setDailyBudgetUsd(String(result.controls.dailyBudgetUsd));
      setMaxConcurrentJobs(String(result.controls.maxConcurrentJobs));
      setMessage("BYOK spend controls saved.");
    }
  };

  const remove = async (connection: Connection) => {
    if (!connection || !window.confirm("Delete this encrypted Provider Connection?")) return;
    const result = await mutate(
      `delete-${connection.provider}`,
      `/api/provider-connections/${encodeURIComponent(connection.id)}`,
      { method: "DELETE" },
    );
    if (result) {
      if (connection.provider === "openrouter") setResults([]);
      setMessage("Connection deleted from the live application.");
      await load();
    }
  };

  const run = async () => {
    if (!openRouterConnection || openRouterConnection.verificationStatus !== "valid") return;
    const list = keywords.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    const result = await mutate("run", "/api/research/byok/semantic-filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        executionMode: "byok",
        provider: "openrouter",
        connectionId: openRouterConnection.id,
        expectedConnectionVersion: openRouterConnection.credentialVersion,
        keywords: list,
      }),
    });
    if (Array.isArray(result?.results)) {
      setResults(result.results);
      setMessage("Completed with your key. The result is private.");
    } else if (result?.status === "pending") {
      setMessage("Request started; it will not be automatically charged again.");
    }
  };

  const quoteTrends = async () => {
    if (!dataForSeoConnection || dataForSeoConnection.verificationStatus !== "valid") return;
    const result = await mutate("quote-trends", "/api/research/byok/trends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "quote",
        executionMode: "byok",
        provider: "dataforseo",
        connectionId: dataForSeoConnection.id,
        expectedConnectionVersion: dataForSeoConnection.credentialVersion,
        clientRequestId: crypto.randomUUID(),
        keyword: trendsKeyword,
        benchmark: "gpts",
        days: Number(trendsDays),
      }),
    });
    if (result?.quote && result?.request && result?.requestHash) {
      setTrendsQuote(result as TrendsQuote);
      setTrendsResult(null);
      setMessage("Review the exact estimate, then confirm the paid request.");
    }
  };

  const confirmTrends = async () => {
    if (!dataForSeoConnection || !trendsQuote) return;
    const result = await mutate("run-trends", "/api/research/byok/trends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "execute",
        executionMode: "byok",
        provider: "dataforseo",
        connectionId: dataForSeoConnection.id,
        expectedConnectionVersion: dataForSeoConnection.credentialVersion,
        request: trendsQuote.request,
        quoteId: trendsQuote.quote.quoteId,
        requestHash: trendsQuote.requestHash,
        confirmedEstimatedCostUsd: trendsQuote.quote.estimatedCostUsd,
        confirmation: "CONFIRM",
      }),
    });
    if (result?.data) {
      setTrendsResult(result.data);
      setTrendsQuote(null);
      setMessage("Trends completed with your DataForSEO account. The result is private.");
    } else if (result?.status === "pending") {
      setMessage("The paid request started and will not be submitted again automatically.");
    }
  };

  const quoteSerp = async () => {
    if (!dataForSeoConnection || dataForSeoConnection.verificationStatus !== "valid") return;
    const result = await mutate("quote-serp", "/api/research/byok/serp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "quote",
        executionMode: "byok",
        provider: "dataforseo",
        connectionId: dataForSeoConnection.id,
        expectedConnectionVersion: dataForSeoConnection.credentialVersion,
        clientRequestId: crypto.randomUUID(),
        keyword: serpKeyword,
      }),
    });
    if (result?.quote && result?.request && result?.requestHash) {
      setSerpQuote(result as SerpQuote);
      setSerpResult(null);
      setMessage("Review the exact SERP estimate, then confirm the paid request.");
    }
  };

  const confirmSerp = async () => {
    if (!dataForSeoConnection || !serpQuote) return;
    const result = await mutate("run-serp", "/api/research/byok/serp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "execute",
        executionMode: "byok",
        provider: "dataforseo",
        connectionId: dataForSeoConnection.id,
        expectedConnectionVersion: dataForSeoConnection.credentialVersion,
        request: serpQuote.request,
        quoteId: serpQuote.quote.quoteId,
        requestHash: serpQuote.requestHash,
        confirmedEstimatedCostUsd: serpQuote.quote.estimatedCostUsd,
        confirmation: "CONFIRM",
      }),
    });
    if (result?.data) {
      setSerpResult(result.data);
      setSerpQuote(null);
      setMessage("SERP completed with your DataForSEO account. The result is private.");
    } else if (result?.status === "pending") {
      setMessage("The paid SERP request started and will not be submitted again automatically.");
    }
  };

  if (!available) return null;
  return (
    <section className="rounded-xl border border-cyan-500/20 bg-card/90 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="h-5 w-5 text-cyan-500" /> BYOK Live Mode
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your key is encrypted, never displayed again, and never falls back to a platform key.
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">
          {liveEnabled ? "Internal preview" : "Connection management only"}
        </span>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border p-4">
          <h4 className="font-medium">OpenRouter</h4>
          <p className="mt-1 text-xs text-muted-foreground">Used only for explicitly selected AI operations.</p>
          <div className="mt-3 grid gap-3">
            <input value={openRouterLabel} onChange={(e) => setOpenRouterLabel(e.target.value)} maxLength={120}
              className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Connection label" />
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm" autoComplete="new-password"
              placeholder={openRouterConnection ? "New key to rotate credential" : "OpenRouter API key"} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={saveOpenRouter} disabled={Boolean(busy)}>
              {busy === "save-openrouter" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {openRouterConnection ? "Rotate credential" : "Save connection"}
            </Button>
            {openRouterConnection && <>
              <Button type="button" variant="outline" onClick={() => verify(openRouterConnection)} disabled={Boolean(busy)}>
                <RefreshCw className="mr-2 h-4 w-4" /> Verify
              </Button>
              <Button type="button" variant="ghost" onClick={() => remove(openRouterConnection)} disabled={Boolean(busy)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </>}
          </div>
          {openRouterConnection && <div className="mt-3 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <ShieldCheck className="h-4 w-4" /><span>{openRouterConnection.maskedHint}</span>
            <span className="text-muted-foreground">v{openRouterConnection.credentialVersion}</span>
            <span className="ml-auto capitalize">{openRouterConnection.verificationStatus}</span>
          </div>}
        </div>

        <div className="rounded-lg border p-4">
          <h4 className="font-medium">DataForSEO</h4>
          <p className="mt-1 text-xs text-muted-foreground">Used only for explicitly selected research operations.</p>
          <div className="mt-3 grid gap-3">
            <input value={dataForSeoLabel} onChange={(e) => setDataForSeoLabel(e.target.value)} maxLength={120}
              className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Connection label" />
            <input value={dataForSeoLogin} onChange={(e) => setDataForSeoLogin(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm" autoComplete="off"
              placeholder={dataForSeoConnection ? "Login required to rotate" : "DataForSEO login"} />
            <input type="password" value={dataForSeoPassword} onChange={(e) => setDataForSeoPassword(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm" autoComplete="new-password"
              placeholder={dataForSeoConnection ? "New password to rotate" : "DataForSEO password"} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" onClick={saveDataForSeo} disabled={Boolean(busy)}>
              {busy === "save-dataforseo" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dataForSeoConnection ? "Rotate credential" : "Save connection"}
            </Button>
            {dataForSeoConnection && <>
              <Button type="button" variant="outline" onClick={() => verify(dataForSeoConnection)} disabled={Boolean(busy)}>
                <RefreshCw className="mr-2 h-4 w-4" /> Verify free
              </Button>
              <Button type="button" variant="ghost" onClick={() => remove(dataForSeoConnection)} disabled={Boolean(busy)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </Button>
            </>}
          </div>
          {dataForSeoConnection && <div className="mt-3 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            <ShieldCheck className="h-4 w-4" /><span>{dataForSeoConnection.maskedHint}</span>
            <span className="text-muted-foreground">v{dataForSeoConnection.credentialVersion}</span>
            <span className="ml-auto capitalize">{dataForSeoConnection.verificationStatus}</span>
          </div>}
        </div>
      </div>
      <div className="mt-4 rounded-lg border p-4">
        <h4 className="font-medium">Spend controls</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Paid BYOK research will require an exact cost quote confirmation and is blocked by these owner-scoped limits.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Daily budget (USD, max {spendPolicy.maxDailyBudgetUsd})
            <input type="number" min="0.000001" max={spendPolicy.maxDailyBudgetUsd} step="0.01"
              value={dailyBudgetUsd} onChange={(e) => setDailyBudgetUsd(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Maximum concurrent jobs (max {spendPolicy.maxConcurrentJobs})
            <input type="number" min="1" max={spendPolicy.maxConcurrentJobs} step="1"
              value={maxConcurrentJobs} onChange={(e) => setMaxConcurrentJobs(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
        </div>
        <Button type="button" variant="outline" className="mt-3"
          onClick={saveSpendControls} disabled={Boolean(busy)}>
          {busy === "save-spend-controls" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save spend controls
        </Button>
      </div>
      {liveEnabled && dataForSeoConnection?.verificationStatus === "valid" && <div className="mt-5 border-t pt-4">
        <h4 className="font-medium">Private Google Trends check</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Quote first. The Provider is called only after a separate exact-cost confirmation.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_8rem]">
          <input value={trendsKeyword} onChange={(e) => {
            setTrendsKeyword(e.target.value);
            setTrendsQuote(null);
          }} className="rounded-lg border bg-background px-3 py-2 text-sm"
            placeholder="Keyword to compare with gpts" />
          <input type="number" min="7" max="1825" value={trendsDays}
            onChange={(e) => { setTrendsDays(e.target.value); setTrendsQuote(null); }}
            className="rounded-lg border bg-background px-3 py-2 text-sm" aria-label="Trend days" />
        </div>
        <Button type="button" variant="outline" className="mt-2" onClick={quoteTrends}
          disabled={Boolean(busy) || !trendsKeyword.trim()}>
          {busy === "quote-trends" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Get exact cost quote
        </Button>
        {trendsQuote && <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p>Estimated DataForSEO charge: <strong>${trendsQuote.quote.estimatedCostUsd.toFixed(3)}</strong></p>
          <p className="mt-1 text-xs text-muted-foreground">
            {trendsQuote.request.dateFrom} to {trendsQuote.request.dateTo}; expires {new Date(trendsQuote.quote.expiresAt).toLocaleTimeString()}.
          </p>
          <Button type="button" className="mt-2" onClick={confirmTrends} disabled={Boolean(busy)}>
            {busy === "run-trends" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm and run for ${trendsQuote.quote.estimatedCostUsd.toFixed(3)}
          </Button>
        </div>}
        {trendsResult && <pre className="mt-3 max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
          {JSON.stringify(trendsResult, null, 2)}
        </pre>}
      </div>}
      {liveEnabled && dataForSeoConnection?.verificationStatus === "valid" && <div className="mt-5 border-t pt-4">
        <h4 className="font-medium">Private Google SERP check</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          One fixed 10-result US desktop SERP. Quote first; no Provider call occurs before confirmation.
        </p>
        <input value={serpKeyword} onChange={(e) => {
          setSerpKeyword(e.target.value);
          setSerpQuote(null);
        }} maxLength={160} className="mt-3 w-full rounded-lg border bg-background px-3 py-2 text-sm"
          placeholder="Keyword to inspect" />
        <Button type="button" variant="outline" className="mt-2" onClick={quoteSerp}
          disabled={Boolean(busy) || !serpKeyword.trim()}>
          {busy === "quote-serp" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Get exact SERP cost quote
        </Button>
        {serpQuote && <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p>Estimated DataForSEO charge: <strong>${serpQuote.quote.estimatedCostUsd.toFixed(3)}</strong></p>
          <p className="mt-1 text-xs text-muted-foreground">
            Fixed depth: 10 results; expires {new Date(serpQuote.quote.expiresAt).toLocaleTimeString()}.
          </p>
          <Button type="button" className="mt-2" onClick={confirmSerp} disabled={Boolean(busy)}>
            {busy === "run-serp" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm and run for ${serpQuote.quote.estimatedCostUsd.toFixed(3)}
          </Button>
        </div>}
        {serpResult && <pre className="mt-3 max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
          {JSON.stringify(serpResult, null, 2)}
        </pre>}
      </div>}
      {liveEnabled && openRouterConnection?.verificationStatus === "valid" && <div className="mt-5 border-t pt-4">
        <h4 className="font-medium">Private keyword semantic filter</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Up to 20 comma- or line-separated keywords. This explicitly spends your OpenRouter quota.
        </p>
        <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={4}
          className="mt-3 w-full rounded-lg border bg-background px-3 py-2 text-sm"
          placeholder={"ai resume builder\ncelebrity news"} />
        <Button type="button" className="mt-2" onClick={run} disabled={Boolean(busy)}>
          {busy === "run" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Run with my key
        </Button>
        {results.length > 0 && <div className="mt-3 space-y-2">{results.map((item) =>
          <div key={item.keyword} className="rounded-lg border px-3 py-2 text-sm">
            <div className="flex justify-between gap-3"><span className="font-medium">{item.keyword}</span>
              <span className={item.decision === "keep" ? "text-emerald-600" : "text-amber-600"}>{item.decision}</span></div>
            <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
          </div>)}</div>}
      </div>}
      {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
