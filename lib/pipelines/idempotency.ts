import { createHash } from "crypto";

type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike | undefined };

export const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
};

export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const hashPayload = (value: unknown): string => sha256Hex(stableStringify(value));

const normalizePart = (part: string) =>
  part.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");

export const makePipelineRunKey = (
  pipeline: string,
  businessDate: string,
  extra?: JsonLike
) => {
  const prefix = `run:${normalizePart(pipeline)}:${normalizePart(businessDate)}`;
  return extra === undefined ? prefix : `${prefix}:${hashPayload(extra).slice(0, 16)}`;
};

export const makePipelineTaskKey = (input: {
  pipeline: string;
  runKey: string;
  stage: string;
  payload?: unknown;
}) =>
  `task:${normalizePart(input.pipeline)}:${normalizePart(input.runKey)}:${normalizePart(
    input.stage
  )}:${hashPayload(input.payload ?? {}).slice(0, 24)}`;

export const makeCostEventKey = (input: {
  provider: string;
  endpoint: string;
  idempotencyKey?: string | null;
  taskId?: string | null;
  providerRequestId?: string | null;
  payload?: unknown;
}) => {
  const basis =
    input.providerRequestId ||
    input.idempotencyKey ||
    input.taskId ||
    hashPayload(input.payload ?? {});
  return `cost:${normalizePart(input.provider)}:${normalizePart(input.endpoint)}:${hashPayload(
    basis
  ).slice(0, 24)}`;
};
