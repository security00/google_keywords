import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

type D1ApiMeta = {
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  duration?: number;
  size_after?: number;
  num_tables?: number;
};

const normalizeParams = (params: unknown[]) =>
  params.map((value) => (value === undefined ? null : value));

const getBoundD1 = async (): Promise<CloudflareEnv["DB"]> => {
  try {
    const { env } = await getCloudflareContext({ async: true });
    if (typeof env.DB?.prepare !== "function") {
      throw new Error("DB binding is missing");
    }
    return env.DB;
  } catch (error) {
    throw new Error(
      "D1 binding DB is unavailable. Worker requests must not fall back to the Cloudflare REST API.",
      { cause: error },
    );
  }
};

const d1QueryViaBinding = async <T = Record<string, unknown>>(
  db: CloudflareEnv["DB"],
  sql: string,
  params: unknown[]
): Promise<{ rows: T[]; meta?: D1ApiMeta }> => {
  const statement = db.prepare(sql).bind(...normalizeParams(params));
  const result = await statement.all<T>();
  return { rows: result.results ?? [], meta: result.meta as D1ApiMeta };
};

export const d1Query = async <T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<{ rows: T[]; meta?: D1ApiMeta }> => {
  const boundD1 = await getBoundD1();
  return d1QueryViaBinding<T>(boundD1, sql, params);
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
