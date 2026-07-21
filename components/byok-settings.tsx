"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Play, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Connection = {
  id: string;
  provider: "openrouter";
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

export function ByokSettings() {
  const [available, setAvailable] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [label, setLabel] = useState("Primary OpenRouter");
  const [apiKey, setApiKey] = useState("");
  const [keywords, setKeywords] = useState("");
  const [results, setResults] = useState<SemanticResult[]>([]);
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
    const current = Array.isArray(body.connections) ? body.connections[0] ?? null : null;
    setConnection(current);
    if (current?.label) setLabel(current.label);
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

  const save = async () => {
    if (!apiKey.trim()) return setMessage("Enter an OpenRouter API key.");
    const body = connection
      ? {
          label,
          credential: { apiKey: apiKey.trim() },
          expectedCredentialVersion: connection.credentialVersion,
        }
      : { provider: "openrouter", label, credential: { apiKey: apiKey.trim() } };
    const result = await mutate(
      "save",
      connection ? `/api/provider-connections/${encodeURIComponent(connection.id)}` : "/api/provider-connections",
      {
        method: connection ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (result) {
      setApiKey("");
      setMessage(connection ? "Credential rotated. Verify it before use." : "Connection saved. Verify it before use.");
      await load();
    }
  };

  const verify = async () => {
    if (!connection) return;
    const result = await mutate(
      "verify",
      `/api/provider-connections/${encodeURIComponent(connection.id)}/verify`,
      { method: "POST" },
    );
    if (result) {
      setMessage(result.verification?.code || "Verification finished.");
      await load();
    }
  };

  const remove = async () => {
    if (!connection || !window.confirm("Delete this encrypted Provider Connection?")) return;
    const result = await mutate(
      "delete",
      `/api/provider-connections/${encodeURIComponent(connection.id)}`,
      { method: "DELETE" },
    );
    if (result) {
      setResults([]);
      setMessage("Connection deleted from the live application.");
      await load();
    }
  };

  const run = async () => {
    if (!connection || connection.verificationStatus !== "valid") return;
    const list = keywords.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    const result = await mutate("run", "/api/research/byok/semantic-filter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        executionMode: "byok",
        provider: "openrouter",
        connectionId: connection.id,
        expectedConnectionVersion: connection.credentialVersion,
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
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120}
          className="rounded-lg border bg-background px-3 py-2 text-sm" placeholder="Connection label" />
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          className="rounded-lg border bg-background px-3 py-2 text-sm" autoComplete="new-password"
          placeholder={connection ? "New key to rotate credential" : "OpenRouter API key"} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={Boolean(busy)}>
          {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {connection ? "Rotate credential" : "Save connection"}
        </Button>
        {connection && <>
          <Button type="button" variant="outline" onClick={verify} disabled={Boolean(busy)}>
            <RefreshCw className="mr-2 h-4 w-4" /> Verify
          </Button>
          <Button type="button" variant="ghost" onClick={remove} disabled={Boolean(busy)}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </Button>
        </>}
      </div>
      {connection && <div className="mt-3 flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        <ShieldCheck className="h-4 w-4" /><span>{connection.maskedHint}</span>
        <span className="text-muted-foreground">v{connection.credentialVersion}</span>
        <span className="ml-auto capitalize">{connection.verificationStatus}</span>
      </div>}
      {liveEnabled && connection?.verificationStatus === "valid" && <div className="mt-5 border-t pt-4">
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
