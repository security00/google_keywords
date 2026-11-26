import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/authz";
import { d1Query } from "@/lib/d1";

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

function readItem(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.keyword !== "string" || !row.keyword.trim() || row.keyword.length > 300 ||
      typeof row.verdict !== "string" || !["strong", "pass", "close", "watch", "fail"].includes(row.verdict)) return null;
  const metric = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const short = (v: unknown) => typeof v === "string" ? v.trim().slice(0, 400) : "";
  const roots = Array.isArray(row.roots) ? row.roots.map(short).filter(Boolean).slice(0, 12) : [];
  return {
    keyword: row.keyword.trim(), verdict: row.verdict, roots,
    ratioRecent: metric(row.ratioRecent), ratioPeak: metric(row.ratioPeak), slopeDiff: metric(row.slopeDiff),
    freshness: short(row.freshness), summary: short(row.summary), demand: short(row.demand),
  };
}

export async function POST(request: Request) {
  if (!(await isCronRequest(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!isDate(body?.batchDate) || !isDate(body?.dataDate) ||
      typeof body.runId !== "string" || !body.runId.trim() || body.runId.length > 160 ||
      typeof body.benchmark !== "string" || !body.benchmark.trim() || body.benchmark.length > 120 ||
      !Array.isArray(body.items) || body.items.length > 500) {
    return NextResponse.json({ error: "Invalid publication" }, { status: 400 });
  }
  const items = body.items.map(readItem) as Array<ReturnType<typeof readItem>>;
  if (items.some(item => !item)) return NextResponse.json({ error: "Invalid result" }, { status: 400 });
  if (new Set(items.map(item => item!.keyword.toLowerCase())).size !== items.length) {
    return NextResponse.json({ error: "Duplicate keyword" }, { status: 400 });
  }
  // A retry publishes the same batch atomically. A delayed older batch cannot
  // displace a later data window in the reader.
  await d1Query(
    `INSERT INTO shared_keyword_publications (batch_date, data_date, run_id, benchmark, items_json)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(batch_date) DO UPDATE SET
       data_date=excluded.data_date, run_id=excluded.run_id, benchmark=excluded.benchmark,
       items_json=excluded.items_json, published_at=CURRENT_TIMESTAMP
     WHERE excluded.data_date >= shared_keyword_publications.data_date`,
    [body.batchDate, body.dataDate, body.runId, body.benchmark, JSON.stringify(items)],
  );
  return NextResponse.json({ ok: true });
}
