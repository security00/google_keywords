import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import {
  STRIPE_WEBHOOK_STALE_MS,
  StripeWebhookEventPersistenceError,
  claimStripeWebhookEvent,
  completeStripeWebhookEvent,
} from "./stripe-webhook-events";

vi.mock("@/lib/d1", () => ({ d1Query: vi.fn() }));

const mockD1Query = vi.mocked(d1Query);

describe("Stripe webhook event ledger", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
  });

  test("claims a new event with an insert that ignores conflicts", async () => {
    mockD1Query.mockResolvedValueOnce({
      rows: [{ event_id: "evt_1", status: "processing", received_at: "2026-08-17T00:00:00.000Z" }],
    });

    await expect(
      claimStripeWebhookEvent(
        "evt_1",
        "invoice.paid",
        new Date("2026-08-17T00:00:00.000Z")
      )
    ).resolves.toEqual({ kind: "claimed" });

    expect(String(mockD1Query.mock.calls[0][0])).toContain("ON CONFLICT(event_id) DO NOTHING");
    expect(mockD1Query.mock.calls[0][1]).toEqual([
      "evt_1",
      "invoice.paid",
      "2026-08-17T00:00:00.000Z",
    ]);
  });

  test("returns duplicate for an already processed event", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          event_id: "evt_1",
          status: "processed",
          received_at: "2026-08-17T00:00:00.000Z",
        }],
      });

    await expect(
      claimStripeWebhookEvent("evt_1", "invoice.paid")
    ).resolves.toEqual({ kind: "duplicate" });
  });

  test("reclaims a failed event so Stripe retries can apply", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          event_id: "evt_1",
          status: "failed",
          received_at: "2026-08-17T00:00:00.000Z",
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          event_id: "evt_1",
          status: "processing",
          received_at: "2026-08-17T00:03:00.000Z",
        }],
      });

    await expect(
      claimStripeWebhookEvent(
        "evt_1",
        "invoice.paid",
        new Date("2026-08-17T00:03:00.000Z")
      )
    ).resolves.toEqual({ kind: "claimed" });
    expect(String(mockD1Query.mock.calls[2][0])).toContain("UPDATE stripe_webhook_events");
  });

  test("keeps a fresh in-flight claim from racing", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          event_id: "evt_1",
          status: "processing",
          received_at: "2026-08-17T00:00:00.000Z",
        }],
      });

    await expect(
      claimStripeWebhookEvent(
        "evt_1",
        "invoice.paid",
        new Date(Date.parse("2026-08-17T00:00:00.000Z") + STRIPE_WEBHOOK_STALE_MS - 1)
      )
    ).resolves.toEqual({ kind: "in_flight" });
  });

  test("maps D1 failures to a stable persistence error", async () => {
    mockD1Query.mockRejectedValue(new Error("SQL noise"));

    await expect(claimStripeWebhookEvent("evt_1", "invoice.paid"))
      .rejects.toBeInstanceOf(StripeWebhookEventPersistenceError);
    await expect(completeStripeWebhookEvent("evt_1"))
      .rejects.toBeInstanceOf(StripeWebhookEventPersistenceError);
  });
});
