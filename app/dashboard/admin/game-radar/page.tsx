"use client";

import { useEffect, useState } from "react";
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
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
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
          <h2 className="font-semibold">最新候选</h2>
          <p className="text-xs text-muted-foreground">这些只是 sitemap/page 提词结果，后续还必须经过 Trends 和 SERP 游戏相关性校验。</p>
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
              ) : data?.candidates.length ? (
                data.candidates.map((row) => (
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
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">暂无候选</td></tr>
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
