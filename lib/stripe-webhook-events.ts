import "server-only";

import { d1Query } from "@/lib/d1";

export const STRIPE_WEBHOOK_STALE_MS = 2 * 60 * 1000;

export type StripeWebhookClaim =
  | { kind: "claimed" }
  | { kind: "duplicate" }
  | { kind: "in_flight" };

type EventRow = {
  event_id: string;
  status: "processing" | "processed" | "failed";
  received_at: string;
};

export class StripeWebhookEventPersistenceError extends Error {
  readonly code = "STRIPE_WEBHOOK_EVENT_PERSISTENCE_ERROR" as const;

  constructor() {
    super("STRIPE_WEBHOOK_EVENT_PERSISTENCE_ERROR");
    this.name = "StripeWebhookEventPersistenceError";
  }
}

const isStaleProcessing = (receivedAt: string, now: Date): boolean => {
  const receivedMs = Date.parse(receivedAt);
  return Number.isFinite(receivedMs) && now.getTime() - receivedMs >= STRIPE_WEBHOOK_STALE_MS;
};

export const claimStripeWebhookEvent = async (
  eventId: string,
  eventType: string,
  now = new Date()
): Promise<StripeWebhookClaim> => {
  const nowIso = now.toISOString();

  try {
    const inserted = await d1Query<EventRow>(
      `INSERT INTO stripe_webhook_events (
         event_id, event_type, status, received_at, processed_at
       ) VALUES (?, ?, 'processing', ?, NULL)
       ON CONFLICT(event_id) DO NOTHING
       RETURNING event_id, status, received_at`,
      [eventId, eventType, nowIso]
    );
    if (inserted.rows[0]) return { kind: "claimed" };

    const existing = await d1Query<EventRow>(
      `SELECT event_id, status, received_at
       FROM stripe_webhook_events
       WHERE event_id = ?
       LIMIT 1`,
      [eventId]
    );
    const row = existing.rows[0];
    if (!row) throw new StripeWebhookEventPersistenceError();
    if (row.status === "processed") return { kind: "duplicate" };

    const canReclaim =
      row.status === "failed" ||
      (row.status === "processing" && isStaleProcessing(row.received_at, now));
    if (!canReclaim) return { kind: "in_flight" };

    const reclaimed = await d1Query<EventRow>(
      `UPDATE stripe_webhook_events
       SET status = 'processing',
           event_type = ?,
           received_at = ?,
           processed_at = NULL
       WHERE event_id = ?
         AND (
           status = 'failed'
           OR (status = 'processing' AND received_at <= ?)
         )
       RETURNING event_id, status, received_at`,
      [
        eventType,
        nowIso,
        eventId,
        new Date(now.getTime() - STRIPE_WEBHOOK_STALE_MS).toISOString(),
      ]
    );
    return reclaimed.rows[0] ? { kind: "claimed" } : { kind: "in_flight" };
  } catch (error) {
    if (error instanceof StripeWebhookEventPersistenceError) throw error;
    throw new StripeWebhookEventPersistenceError();
  }
};

export const completeStripeWebhookEvent = async (
  eventId: string,
  now = new Date()
): Promise<void> => {
  try {
    await d1Query(
      `UPDATE stripe_webhook_events
       SET status = 'processed', processed_at = ?
       WHERE event_id = ?`,
      [now.toISOString(), eventId]
    );
  } catch {
    throw new StripeWebhookEventPersistenceError();
  }
};

export const failStripeWebhookEvent = async (eventId: string): Promise<void> => {
  try {
    await d1Query(
      `UPDATE stripe_webhook_events
       SET status = 'failed'
       WHERE event_id = ? AND status = 'processing'`,
      [eventId]
    );
  } catch {
    throw new StripeWebhookEventPersistenceError();
  }
};
