#!/usr/bin/env node

import { readFileSync } from "node:fs";

const stagingPath = "wrangler.staging.jsonc";
const productionPath = "wrangler.jsonc";
const staging = JSON.parse(readFileSync(stagingPath, "utf8"));
const production = JSON.parse(readFileSync(productionPath, "utf8"));
const errors = [];

const stagingDb = staging.d1_databases?.find((binding) => binding.binding === "DB");
const productionDb = production.d1_databases?.find((binding) => binding.binding === "DB");
const selfReference = staging.services?.find(
  (binding) => binding.binding === "WORKER_SELF_REFERENCE",
);
const stagingUrl = `https://${staging.name}.potter-faa.workers.dev`;

if (!staging.name || staging.name === production.name) {
  errors.push("staging Worker name must differ from production");
}
if (!staging.name.endsWith("-staging")) {
  errors.push("staging Worker name must end with -staging");
}
if (!stagingDb || !productionDb) {
  errors.push("both configs must define the DB binding");
} else {
  if (stagingDb.database_id === productionDb.database_id) {
    errors.push("staging DB id must differ from production");
  }
  if (stagingDb.database_name === productionDb.database_name) {
    errors.push("staging DB name must differ from production");
  }
  if (!stagingDb.database_name.endsWith("-staging")) {
    errors.push("staging DB name must end with -staging");
  }
}
if (selfReference?.service !== staging.name) {
  errors.push("WORKER_SELF_REFERENCE must point to the staging Worker");
}
if (staging.vars?.NEXT_PUBLIC_APP_URL !== stagingUrl || staging.vars?.APP_URL !== stagingUrl) {
  errors.push(`staging application URLs must both equal ${stagingUrl}`);
}
if (staging.vars?.AUTH_COOKIE_DOMAIN !== new URL(stagingUrl).hostname) {
  errors.push("staging cookie domain must be the exact staging hostname");
}
if (staging.vars?.AUTH_SESSION_COOKIE !== "kr_staging_session") {
  errors.push("staging must use an isolated session cookie name");
}
if (staging.vars?.AUTH_COOKIE_SECURE !== "true") {
  errors.push("staging session cookie must be secure");
}
if (staging.vars?.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED !== "false") {
  errors.push("Google OAuth must remain disabled in isolated staging");
}
if (staging.vars?.BYOK_PROVIDER_CONNECTIONS_ENABLED !== "false") {
  errors.push("BYOK provider connections must remain disabled");
}
if (staging.vars?.BYOK_LIVE_MODE_ENABLED !== "false") {
  errors.push("BYOK live mode must remain disabled");
}
if (staging.vars?.BYOK_PROVIDER_CONNECTIONS_ALLOWLIST !== "") {
  errors.push("BYOK allowlist must remain empty");
}
if (staging.routes || staging.route || staging.triggers) {
  errors.push("staging must not define production routes or scheduled triggers");
}

const forbiddenVarPattern = /(SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)/i;
for (const key of Object.keys(staging.vars ?? {})) {
  if (forbiddenVarPattern.test(key)) {
    errors.push(`secret-like value must not be stored in vars: ${key}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`staging isolation: ${error}`);
  process.exit(1);
}

console.log(
  `Staging isolation OK: Worker=${staging.name}, D1=${stagingDb.database_name}, BYOK=off, OAuth=off`,
);
