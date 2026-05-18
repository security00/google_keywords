"use client";

import { useEffect, useMemo, useState } from "react";
import { Radar, RefreshCw } from "lucide-react";

type SourceRow = {
  id: string;
  name: string;
  base_url: string;
  sitemap_url: string;
  enabled: number;
  quality_tier: number;
  status_note: string | null;
  last_checked_at: string | null;
  page_count: number;
  candidate_count: number;
  latest_candidate_at: string | null;
};

type CandidateRow = {
  id: string;
  keyword: string;
  keyword_normalized: string;
  source_id: string;
  source_name: string;
  url: string;
  status: string;
  reject_reason: string | null;
  created_at: string;
};

type StatusRow = {
  status: string;
  count: number;
};

type Payload = {
  sources: SourceRow[];
  candidates: CandidateRow[];
  statusCounts: StatusRow[];
};

const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "-";

export default function GameRadarPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingSource, setSavingSource] = useState<string | null>(null);
  const [analyzingSource, setAnalyzingSource] = useState(false);
  const [candidateSourceFilter, setCandidateSourceFilter] = useState("all");
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [rulePreview, setRulePreview] = useState<Array<{ url: string; matched: boolean; excluded: boolean; keyword: string | null; rejectReason: string | null }>>([]);
  const [sourceForm, setSourceForm] = useState({
    id: "",
    name: "",
    baseUrl: "",
    sitemapUrl: "",
    enabled: false,
    qualityTier: 9,
    urlIncludePatterns: "[]",
    urlExcludePatterns: "[]",
    keywordExtractRule: '{"type":"slug"}',
    statusNote: "",
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/game-radar", { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "加载失败");
      setData(payload);
      const notes: Record<string, string> = {};
      for (const source of payload.sources || []) notes[source.id] = source.status_note || "";
      setEditingNotes(notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const totalCandidates = data?.statusCounts.reduce((sum, row) => sum + Number(row.count || 0), 0) ?? 0;
  const candidateSourceOptions = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const candidate of data?.candidates ?? []) {
      const existing = counts.get(candidate.source_id);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(candidate.source_id, {
          id: candidate.source_id,
          name: candidate.source_name || candidate.source_id,
          count: 1,
        });
      }
    }

    return Array.from(counts.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  }, [data?.candidates]);
  const filteredCandidates = useMemo(() => {
    if (!data?.candidates) return [];
    if (candidateSourceFilter === "all") return data.candidates;
    return data.candidates.filter((candidate) => candidate.source_id === candidateSourceFilter);
  }, [candidateSourceFilter, data?.candidates]);

  const updateSource = async (id: string, patch: { enabled?: boolean; statusNote?: string | null }) => {
    setSavingSource(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/game-radar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "保存失败");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingSource(null);
    }
  };

  const saveNoteIfChanged = (row: SourceRow) => {
    const current = row.status_note || "";
    const next = editingNotes[row.id] ?? "";
    if (next !== current) updateSource(row.id, { statusNote: next });
  };

  const saveSourceForm = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingSource(sourceForm.id || "new");
    setError(null);
    try {
      const res = await fetch("/api/admin/game-radar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sourceForm),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "保存失败");
      setSourceForm({
        id: "",
        name: "",
        baseUrl: "",
        sitemapUrl: "",
        enabled: false,
        qualityTier: 9,
        urlIncludePatterns: "[]",
        urlExcludePatterns: "[]",
        keywordExtractRule: '{"type":"slug"}',
        statusNote: "",
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingSource(null);
    }
  };

  const editSource = (row: SourceRow) => {
    setSourceForm({
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      sitemapUrl: row.sitemap_url,
      enabled: Boolean(row.enabled),
      qualityTier: row.quality_tier,
      urlIncludePatterns: "[]",
      urlExcludePatterns: "[]",
      keywordExtractRule: '{"type":"slug"}',
      statusNote: row.status_note || "",
    });
  };

  const analyzeSourceForm = async () => {
    setAnalyzingSource(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/game-radar/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: sourceForm.baseUrl, sitemapUrl: sourceForm.sitemapUrl }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "分析失败");
      setSourceForm((prev) => ({
        ...prev,
        urlIncludePatterns: payload.urlIncludePatterns || prev.urlIncludePatterns,
        urlExcludePatterns: payload.urlExcludePatterns || prev.urlExcludePatterns,
        keywordExtractRule: payload.keywordExtractRule || prev.keywordExtractRule,
        statusNote: payload.statusNote || prev.statusNote,
      }));
      setRulePreview(payload.preview || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setAnalyzingSource(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Radar className="h-6 w-6 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold">Game Page Radar</h1>
            <p className="text-sm text-muted-foreground">
              精选游戏站 sitemap 新页面追踪。当前只做候选预览，不触发 Trends/SERP/LLM，不进学生端。
            </p>
          </div>
        </div>
        <button onClick={load} className="rounded-md border p-2 hover:bg-muted" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="来源数" value={data?.sources.length ?? 0} />
        <Stat label="候选词" value={totalCandidates} />
        <Stat label="状态分布" value={(data?.statusCounts ?? []).map((row) => `${row.status}:${row.count}`).join(" / ") || "-"} />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">新增 / 编辑精选来源</h2>
          <p className="text-xs text-muted-foreground">先保存为停用状态，测试规则通过后再启用。</p>
        </div>
        <form onSubmit={saveSourceForm} className="grid gap-3 p-4 md:grid-cols-2">
          <Input label="Source ID" value={sourceForm.id} onChange={(value) => setSourceForm((prev) => ({ ...prev, id: value }))} placeholder="y8" />
          <Input label="名称" value={sourceForm.name} onChange={(value) => setSourceForm((prev) => ({ ...prev, name: value }))} placeholder="Y8" />
          <Input label="Base URL" value={sourceForm.baseUrl} onChange={(value) => setSourceForm((prev) => ({ ...prev, baseUrl: value }))} placeholder="https://www.y8.com" />
          <Input label="Sitemap URL" value={sourceForm.sitemapUrl} onChange={(value) => setSourceForm((prev) => ({ ...prev, sitemapUrl: value }))} placeholder="https://www.y8.com/sitemap.xml" />
          <Input label="Include patterns JSON" value={sourceForm.urlIncludePatterns} onChange={(value) => setSourceForm((prev) => ({ ...prev, urlIncludePatterns: value }))} placeholder='["/games/"]' />
          <Input label="Exclude patterns JSON" value={sourceForm.urlExcludePatterns} onChange={(value) => setSourceForm((prev) => ({ ...prev, urlExcludePatterns: value }))} placeholder='["/tags/"]' />
          <Input label="提词规则 JSON" value={sourceForm.keywordExtractRule} onChange={(value) => setSourceForm((prev) => ({ ...prev, keywordExtractRule: value }))} placeholder='{"type":"slug"}' />
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>质量层级</span>
            <input className="w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground" type="number" min={1} max={99} value={sourceForm.qualityTier} onChange={(event) => setSourceForm((prev) => ({ ...prev, qualityTier: Number(event.target.value) }))} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sourceForm.enabled} onChange={(event) => setSourceForm((prev) => ({ ...prev, enabled: event.target.checked }))} />
            保存后启用
          </label>
          <label className="space-y-1 text-xs text-muted-foreground md:col-span-2">
            <span>策略备注</span>
            <textarea className="min-h-[72px] w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground" value={sourceForm.statusNote} onChange={(event) => setSourceForm((prev) => ({ ...prev, statusNote: event.target.value }))} />
          </label>
          <div className="flex gap-2 md:col-span-2">
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={!!savingSource} type="submit">保存来源</button>
            <button className="rounded-md border px-4 py-2 text-sm" type="button" onClick={() => setSourceForm({ id: "", name: "", baseUrl: "", sitemapUrl: "", enabled: false, qualityTier: 9, urlIncludePatterns: "[]", urlExcludePatterns: "[]", keywordExtractRule: '{"type":"slug"}', statusNote: "" })}>清空</button>
          </div>
        </form>
        {rulePreview.length > 0 && (
          <div className="border-t px-4 py-3">
            <h3 className="mb-2 text-sm font-semibold">规则测试预览</h3>
            <div className="max-h-[360px] overflow-auto rounded border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <Th>URL</Th>
                    <Th>结果</Th>
                    <Th>Keyword</Th>
                    <Th>原因</Th>
                  </tr>
                </thead>
                <tbody>
                  {rulePreview.slice(0, 30).map((row) => (
                    <tr key={row.url} className="border-t">
                      <Td className="max-w-[520px] truncate" title={row.url}>{row.url}</Td>
                      <Td>{row.excluded ? "排除" : row.matched ? "命中" : "未命中"}</Td>
                      <Td>{row.keyword || "-"}</Td>
                      <Td className="text-muted-foreground">{row.rejectReason || "-"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">精选来源</h2>
          <p className="text-xs text-muted-foreground">可直接启用/停用来源，并在策略备注里记录为什么这么设置。备注失焦保存，Enter 保存。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <Th>来源</Th>
                <Th>状态</Th>
                <Th>策略备注</Th>
                <Th align="right">页面</Th>
                <Th align="right">候选</Th>
                <Th>最近检查</Th>
                <Th>Sitemap</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
              ) : data?.sources.length ? (
                data.sources.map((row) => (
                  <tr key={row.id} className="border-t hover:bg-muted/30">
                    <Td className="font-medium">
                      <button className="text-left hover:underline" type="button" onClick={() => editSource(row)}>{row.name}</button>
                    </Td>
                    <Td>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(row.enabled)}
                        className={`group inline-flex w-[86px] items-center rounded-full border p-1 transition-colors ${row.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}`}
                        disabled={savingSource === row.id}
                        onClick={() => updateSource(row.id, { enabled: !row.enabled })}
                        title={row.enabled ? "点击停用" : "点击启用"}
                      >
                        <span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${row.enabled ? "translate-x-[56px]" : "translate-x-0"}`} />
                        <span className={`ml-2 text-xs font-medium ${row.enabled ? "-translate-x-5" : ""}`}>{savingSource === row.id ? "保存" : row.enabled ? "启用" : "停用"}</span>
                      </button>
                    </Td>
                    <Td className="min-w-[360px] max-w-[520px] text-xs text-muted-foreground">
                      <textarea
                        className="min-h-[44px] w-full resize-y rounded-md border bg-background px-2 py-1 text-xs text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
                        value={editingNotes[row.id] ?? row.status_note ?? ""}
                        disabled={savingSource === row.id}
                        placeholder="点击这里直接编辑来源策略备注"
                        onChange={(event) => setEditingNotes((prev) => ({ ...prev, [row.id]: event.target.value }))}
                        onBlur={() => saveNoteIfChanged(row)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.currentTarget.blur();
                          }
                        }}
                      />
                      <div className="mt-1 text-[11px] text-muted-foreground">失焦保存；Ctrl/⌘ + Enter 保存。</div>
                    </Td>
                    <Td align="right">{row.page_count}</Td>
                    <Td align="right">{row.candidate_count}</Td>
                    <Td>{date(row.last_checked_at)}</Td>
                    <Td className="max-w-[420px] truncate text-muted-foreground" title={row.sitemap_url}>{row.sitemap_url}</Td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">暂无来源</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">最新候选</h2>
              <p className="text-xs text-muted-foreground">这些只是 sitemap/page 提词结果，后续还必须经过 Trends 和 SERP 游戏相关性校验。</p>
            </div>
            <div className="text-xs text-muted-foreground">
              显示 {filteredCandidates.length} / {data?.candidates.length ?? 0}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${candidateSourceFilter === "all" ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              onClick={() => setCandidateSourceFilter("all")}
            >
              全部
              <span className="ml-1 opacity-75">{data?.candidates.length ?? 0}</span>
            </button>
            {candidateSourceOptions.map((source) => (
              <button
                key={source.id}
                type="button"
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${candidateSourceFilter === source.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                onClick={() => setCandidateSourceFilter(source.id)}
                title={source.id}
              >
                {source.name}
                <span className="ml-1 opacity-75">{source.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <Th>关键词</Th>
                <Th>来源</Th>
                <Th>状态</Th>
                <Th>发现时间</Th>
                <Th>URL</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">加载中...</td></tr>
              ) : filteredCandidates.length ? (
                filteredCandidates.map((row) => (
                  <tr key={row.id} className="border-t hover:bg-muted/30">
                    <Td className="font-medium">{row.keyword}</Td>
                    <Td>{row.source_name}</Td>
                    <Td>{row.status}{row.reject_reason ? ` · ${row.reject_reason}` : ""}</Td>
                    <Td>{date(row.created_at)}</Td>
                    <Td className="max-w-[520px] truncate text-muted-foreground" title={row.url}>
                      <a href={row.url} target="_blank" rel="noreferrer" className="hover:underline">{row.url}</a>
                    </Td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{data?.candidates.length ? "当前来源暂无候选" : "暂无候选"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <input className="w-full rounded-md border bg-background px-2 py-2 text-sm text-foreground" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"} font-medium`}>{children}</th>;
}

function Td({ children, align = "left", className = "", title }: { children: React.ReactNode; align?: "left" | "right"; className?: string; title?: string }) {
  return <td title={title} className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}</td>;
}
