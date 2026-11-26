import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { POST } from "@/app/api/cron/shared-opportunities/route";
import { GET as getOld } from "@/app/api/old-keywords/route";
import { d1Query } from "@/lib/d1";
import { listKeywordOpportunities } from "@/lib/opportunities";
import type { SaasEntitlement } from "@/lib/entitlements";

vi.mock("@/lib/d1", () => ({ d1Query: vi.fn() }));
vi.mock("@/lib/authz", () => ({
  isCronRequest: async (r: Request) => r.headers.get("x-cron-secret") === "fixture",
  requireEffectiveUser: async () => ({ userId: "user" }),
  isAuthzError: () => false,
}));

it("publishes, replays and reads shared batches through the student paths against SQLite", async () => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  const db = new DatabaseSync(":memory:");
  try {
    const baseline = readFileSync("migrations/baseline/0000_current_production_schema.sql", "utf8");
    for (const table of ["old_keyword_opportunities", "game_keyword_pipeline", "old_keyword_evaluations"]) {
      db.exec(baseline.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\);`))![0]);
    }
    db.exec(readFileSync("migrations/d1/0032_discovery_evidence.sql", "utf8"));
    vi.mocked(d1Query).mockImplementation(async (sql, params = []) => ({ rows: db.prepare(sql).all(...params) }));
    const entitlement = { allowed: true } as SaasEntitlement;
    const radar = () => listKeywordOpportunities(entitlement);
    const today = new Date().toISOString().slice(0, 10);
    const post = (items: object[], authenticated = true) => POST(new Request("https://example.com/api/cron/shared-opportunities", {
      method: "POST", headers: authenticated ? { "x-cron-secret": "fixture" } : {},
      body: JSON.stringify({ batchDate: today, dataDate: today, runId: "fixture", benchmark: "gpts", items }),
    }));
    db.exec(`INSERT INTO old_keyword_opportunities(keyword, source_seed, score, scan_date, volume, cpc, kd)
             VALUES ('pdf tool','pdf',223744,date('now'),1100,1,18);
             INSERT INTO game_keyword_pipeline(keyword,status,recommendation,serp_organic,trend_checked_at)
             VALUES ('Fresh','recommended','🔥 hot',8,datetime('now')),
                    ('Expired','recommended','🔥 hot',8,datetime('now','-15 days')),
                    ('Unverified','recommended','🔥 hot',0,datetime('now'));`);
    expect((await post([], false)).status).toBe(401);
    expect((await post([{ keyword: "bad", verdict: "invalid" }])).status).toBe(400);
    expect((await radar()).publicationDate).toBeNull();
    const items = [{ keyword: "sample editor", verdict: "pass", ratioRecent: 2, roots: ["editor"], sessionId: "private-field" }];
    expect((await post(items)).ok).toBe(true);
    expect((await post(items)).ok).toBe(true);
    const result = await radar();
    expect(result.unavailableSources).toEqual([]);
    expect(result.total).toBe(3);
    expect(result.items.map(i => i.keyword).sort()).toEqual(["Fresh", "pdf tool", "sample editor"]);
    expect(result.items.find(i => i.pipeline === "google_new")?.sourceLabel).toContain("editor");
    expect(result.items.find(i => i.pipeline === "validated_market")?.opportunityScore).toBeNull();
    expect(db.prepare("SELECT items_json FROM shared_keyword_publications").get().items_json).not.toContain("private-field");
    const old = await (await getOld(new NextRequest("https://example.com/api/old-keywords"))).json();
    expect(old.keywords).toEqual([expect.objectContaining({ keyword: "pdf tool", verifiedScore: null, scanDate: today })]);
    expect(old.keywords[0].trend).toBeUndefined();
    expect((await post([])).ok).toBe(true);
    const empty = await radar();
    expect(empty.publicationDate).toBe(today);
    expect(empty.items.some(i => i.pipeline === "google_new")).toBe(false);
  } finally {
    db.close();
  }
});
