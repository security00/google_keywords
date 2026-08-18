#!/usr/bin/env node
/**
 * Local / CI smoke for the public-signup path.
 *
 * This does not flip NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED, does not call
 * production, and does not create users. It only asserts the production
 * wrangler configs still keep public signup closed.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const assertSignupClosed = (relativePath) => {
  const text = readFileSync(resolve(root, relativePath), "utf8");
  if (!/"NEXT_PUBLIC_PUBLIC_SIGNUP_ENABLED"\s*:\s*"false"/.test(text)) {
    throw new Error(`${relativePath}: public signup must stay "false"`);
  }
};

assertSignupClosed("wrangler.jsonc");
assertSignupClosed("wrangler.staging.jsonc");

console.log("public signup remains closed in wrangler and staging wrangler");
