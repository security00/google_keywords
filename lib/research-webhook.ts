import { createHmac, timingSafeEqual } from "crypto";
import { gunzipSync } from "zlib";

export const RESEARCH_WEBHOOK_MAX_RAW_BYTES = 10 * 1024 * 1024;
export const RESEARCH_WEBHOOK_MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
export const RESEARCH_WEBHOOK_TOKEN_PARAM = "cb";

export class ResearchWebhookLimitError extends Error {
  readonly status = 413;

  constructor(message = "payload too large") {
    super(message);
    this.name = "ResearchWebhookLimitError";
  }
}

export class ResearchWebhookTokenError extends Error {
  readonly status = 403;

  constructor(message = "invalid callback token") {
    super(message);
    this.name = "ResearchWebhookTokenError";
  }
}

const webhookTokenSecret = (): string | undefined => {
  const secret =
    process.env.RESEARCH_WEBHOOK_TOKEN_SECRET ||
    process.env.CRON_SECRET ||
    process.env.GK_CRON_SECRET;
  return secret || undefined;
};

export const isResearchWebhookTokenRequired = (): boolean =>
  process.env.RESEARCH_WEBHOOK_TOKEN_REQUIRED === "true";

export const signResearchWebhookToken = (
  cacheKey: string,
  apiType: string
): string | undefined => {
  const secret = webhookTokenSecret();
  if (!secret) return undefined;
  return createHmac("sha256", secret)
    .update(`v1\n${apiType}\n${cacheKey}`)
    .digest("base64url");
};

export const appendResearchWebhookToken = (
  url: string,
  cacheKey: string,
  apiType: string
): string => {
  const token = signResearchWebhookToken(cacheKey, apiType);
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${RESEARCH_WEBHOOK_TOKEN_PARAM}=${encodeURIComponent(token)}`;
};

export const assertResearchWebhookToken = (input: {
  cacheKey: string;
  apiType: string;
  token: string | null;
}): void => {
  if (!input.token) {
    if (isResearchWebhookTokenRequired()) {
      throw new ResearchWebhookTokenError();
    }
    return;
  }

  const expected = signResearchWebhookToken(input.cacheKey, input.apiType);
  if (!expected) return;

  const presented = Buffer.from(input.token);
  const good = Buffer.from(expected);
  if (presented.length !== good.length || !timingSafeEqual(presented, good)) {
    throw new ResearchWebhookTokenError();
  }
};

export const decodeResearchWebhookBody = (raw: Buffer): Buffer => {
  if (raw.length > RESEARCH_WEBHOOK_MAX_RAW_BYTES) {
    throw new ResearchWebhookLimitError();
  }

  try {
    return gunzipSync(raw, {
      maxOutputLength: RESEARCH_WEBHOOK_MAX_UNCOMPRESSED_BYTES,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/maxOutputLength|too large|exceed/i.test(message)) {
      throw new ResearchWebhookLimitError();
    }
    return raw;
  }
};
