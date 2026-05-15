import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

type D1ApiError = {
  code?: number;
  message: string;
};

type D1ApiMeta = {
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  duration?: number;
  size_after?: number;
  num_tables?: number;
};

type D1ApiResult<T> = {
  success: boolean;
  results?: T[];
  meta?: D1ApiMeta;
};

type D1ApiResponse<T> = {
  success: boolean;
  errors?: D1ApiError[];
  messages?: unknown[];
  result?: D1ApiResult<T>[];
};

type BoundD1Result<T> = {
  results?: T[];
  meta?: D1ApiMeta;
  success?: boolean;
};

type BoundD1PreparedStatement = {
  bind: (...values: unknown[]) => BoundD1PreparedStatement;
  all: <T = Record<string, unknown>>() => Promise<BoundD1Result<T>>;
};

type BoundD1Database = {
  prepare: (sql: string) => BoundD1PreparedStatement;
};

const getD1Config = () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.D1_DATABASE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !databaseId || !token) {
    throw new Error("Missing D1 env vars: CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, or CLOUDFLARE_API_TOKEN");
  }

  return { accountId, databaseId, token };
};

const buildD1Url = () => {
  const { accountId, databaseId } = getD1Config();
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
};

const normalizeParams = (params: unknown[]) =>
  params.map((value) => (value === undefined ? null : value));

const getBoundD1 = (): BoundD1Database | null => {
  try {
    const { env } = getCloudflareContext();
    const db = (env as { DB?: BoundD1Database }).DB;
    return typeof db?.prepare === "function" ? db : null;
  } catch {
    return null;
  }
};

const d1QueryViaBinding = async <T = Record<string, unknown>>(
  db: BoundD1Database,
  sql: string,
  params: unknown[]
): Promise<{ rows: T[]; meta?: D1ApiMeta }> => {
  const statement = db.prepare(sql).bind(...normalizeParams(params));
  const result = await statement.all<T>();
  if (result.success === false) {
    throw new Error("D1 query failed");
  }

  return { rows: result.results ?? [], meta: result.meta };
};

const d1QueryViaApi = async <T = Record<string, unknown>>(
  sql: string,
  params: unknown[]
): Promise<{ rows: T[]; meta?: D1ApiMeta }> => {
  const { token } = getD1Config();
  const response = await fetch(buildD1Url(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params: normalizeParams(params) }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`D1 request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as D1ApiResponse<T>;
  if (!payload.success) {
    const message = payload.errors?.map((err) => err.message).join("; ") || "D1 request failed";
    throw new Error(message);
  }

  const result = payload.result?.[0];
  if (!result?.success) {
    throw new Error("D1 query failed");
  }

  return { rows: result.results ?? [], meta: result.meta };
};

export const d1Query = async <T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[]; meta?: D1ApiMeta }> => {
  const boundD1 = getBoundD1();
  if (boundD1) {
    return d1QueryViaBinding<T>(boundD1, sql, params);
  }

  return d1QueryViaApi<T>(sql, params);
};

export const d1InsertMany = async (
  table: string,
  columns: string[],
  rows: unknown[][],
  chunkSize = 200,
  options?: {
    insertMode?: "INSERT" | "INSERT OR IGNORE";
  }
) => {
  if (!rows.length) return;

  const MAX_D1_PARAMS = 900;
  const maxRowsByParams = Math.max(1, Math.floor(MAX_D1_PARAMS / columns.length));
  const effectiveChunkSize = Math.min(chunkSize, maxRowsByParams);

  const insertMode = options?.insertMode ?? "INSERT";
  const columnList = columns.join(", ");
  const shouldSplitChunk = (message: string) => {
    const lowered = message.toLowerCase();
    return (
      lowered.includes("statement too long") ||
      lowered.includes("too many sql variables") ||
      lowered.includes("too many parameters")
    );
  };

  const insertChunk = async (chunk: unknown[][]): Promise<void> => {
    const placeholders = chunk
      .map(() => `(${columns.map(() => "?").join(", ")})`)
      .join(", ");
    const sql = `${insertMode} INTO ${table} (${columnList}) VALUES ${placeholders}`;
    const params = chunk.flatMap((row) =>
      row.map((value) => (value === undefined ? null : value))
    );

    try {
      await d1Query(sql, params);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      if (chunk.length > 1 && shouldSplitChunk(message)) {
        const mid = Math.ceil(chunk.length / 2);
        await insertChunk(chunk.slice(0, mid));
        await insertChunk(chunk.slice(mid));
        return;
      }
      throw error;
    }
  };

  for (let i = 0; i < rows.length; i += effectiveChunkSize) {
    const chunk = rows.slice(i, i + effectiveChunkSize);
    await insertChunk(chunk);
  }
};
