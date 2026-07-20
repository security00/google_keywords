import { createHash } from "node:crypto";

// Production applied 0019 before its checksum was normalized for repository
// line endings. The resulting schema has been verified against the canonical
// migration. Keep this exception bound to both the recorded and canonical
// hashes so a future edit to the migration still fails closed.
const LEGACY_CHECKSUM_ALIASES = Object.freeze({
  "0019": Object.freeze({
    "10a46cc5adc2914adcd57a10bc9bbcfe8cff915330691d136b585e5785a26d08":
      "7dcc2526435ad39d773141bda27a3a8083c5ece345eaf8fbdd7fa0c38f9f4dad",
  }),
});

export function canonicalMigrationChecksum(content) {
  const canonicalContent = content.replace(/\r\n/g, "\n");
  return createHash("sha256").update(canonicalContent).digest("hex");
}

export function isAcceptedMigrationChecksum(
  version,
  recordedChecksum,
  canonicalChecksum,
) {
  if (recordedChecksum === canonicalChecksum) return true;
  return LEGACY_CHECKSUM_ALIASES[version]?.[recordedChecksum] === canonicalChecksum;
}
