#!/usr/bin/env node
/**
 * scripts/migrate-api-key-hashes.mjs
 * 一次性脚本：为 api_keys 表中所有 active key 计算 SHA256 hash 并写入 key_hash 列。
 * 运行: node scripts/migrate-api-key-hashes.mjs
 */

import { createHash } from "crypto";

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const D1_ID = "b40de8a4-75e1-4df6-a84d-3ecd62b70538"; // ai-trends

async function d1Query(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  return data.result[0];
}

async function main() {
  // Read all active keys
  const { results: keys } = await d1Query(
    "SELECT id, key FROM api_keys WHERE active = 1"
  );
  console.log(`Found ${keys.length} active keys to migrate`);

  for (const k of keys) {
    const hash = createHash("sha256").update(k.key).digest("hex");
    await d1Query("UPDATE api_keys SET key_hash = ? WHERE id = ?", [
      hash,
      k.id,
    ]);
    console.log(`  id=${k.id} prefix=${k.key.slice(0, 15)}... hash=${hash.slice(0, 16)}...`);
  }

  // Verify
  const { results: migrated } = await d1Query(
    "SELECT id, key_hash FROM api_keys WHERE active = 1 AND key_hash IS NOT NULL"
  );
  console.log(`\n✅ Migrated ${migrated.length}/${keys.length} keys successfully`);

  if (migrated.length < keys.length) {
    console.log("⚠️ Some keys were not migrated");
  }
}

main().catch(console.error);
