import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  canonicalMigrationChecksum,
  isAcceptedMigrationChecksum,
} from "../scripts/schema/migration-checksum-policy.mjs";

const LEGACY_0019 =
  "10a46cc5adc2914adcd57a10bc9bbcfe8cff915330691d136b585e5785a26d08";
const CANONICAL_0019 =
  "7dcc2526435ad39d773141bda27a3a8083c5ece345eaf8fbdd7fa0c38f9f4dad";

describe("migration checksum policy", () => {
  it("normalizes CRLF before hashing", () => {
    expect(canonicalMigrationChecksum("one\r\ntwo\r\n")).toBe(
      canonicalMigrationChecksum("one\ntwo\n"),
    );
  });

  it("accepts an exact canonical checksum", () => {
    expect(
      isAcceptedMigrationChecksum("0018", CANONICAL_0019, CANONICAL_0019),
    ).toBe(true);
  });

  it("accepts the verified 0019 legacy checksum only for its canonical file", () => {
    const migration = readFileSync(
      new URL("../migrations/d1/0019_pipeline_cost_attribution.sql", import.meta.url),
      "utf8",
    );
    expect(canonicalMigrationChecksum(migration)).toBe(CANONICAL_0019);
    expect(
      isAcceptedMigrationChecksum("0019", LEGACY_0019, CANONICAL_0019),
    ).toBe(true);
    expect(
      isAcceptedMigrationChecksum("0019", LEGACY_0019, "changed-content"),
    ).toBe(false);
    expect(
      isAcceptedMigrationChecksum("0018", LEGACY_0019, CANONICAL_0019),
    ).toBe(false);
  });
});
