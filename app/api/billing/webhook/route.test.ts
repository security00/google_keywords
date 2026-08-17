import { beforeEach, describe, expect, test, vi } from "vitest";

const mockConstructEvent = vi.hoisted(() => vi.fn());
const mockUpsertSubscriptionById = vi.hoisted(() => vi.fn());
const mockUpsertStripeSubscription = vi.hoisted(() => vi.fn());
const mockClaim = vi.hoisted(() => vi.fn());
const mockComplete = vi.hoisted(() => vi.fn());
const mockFail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/stripe-billing", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: mockConstructEvent },
  }),
  upsertSubscriptionById: mockUpsertSubscriptionById,
  upsertStripeSubscription: mockUpsertStripeSubscription,
}));

vi.mock("@/lib/stripe-webhook-events", () => ({
  claimStripeWebhookEvent: mockClaim,
  completeStripeWebhookEvent: mockComplete,
  failStripeWebhookEvent: mockFail,
}));

vi.mock("@/lib/lifecycle-emails", () => ({
  sendPaymentSucceededEmail: vi.fn().mockResolvedValue("sent"),
}));

const { POST } = await import("./route");

const postWebhook = (signature = "t=1,v1=sig") =>
  POST(
    new Request("https://discoverkeywords.co/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: JSON.stringify({ id: "evt_1" }),
    })
  );

describe("POST /api/billing/webhook", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    mockConstructEvent.mockReset();
    mockUpsertSubscriptionById.mockReset();
    mockUpsertStripeSubscription.mockReset();
    mockClaim.mockReset();
    mockComplete.mockReset();
    mockFail.mockReset();
    mockConstructEvent.mockReturnValue({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { subscription: "sub_1" } },
    });
    mockClaim.mockResolvedValue({ kind: "claimed" });
    mockComplete.mockResolvedValue(undefined);
    mockFail.mockResolvedValue(undefined);
    mockUpsertSubscriptionById.mockResolvedValue({});
  });

  test("rejects a missing Stripe signature before touching the ledger", async () => {
    const response = await POST(
      new Request("https://discoverkeywords.co/api/billing/webhook", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(400);
    expect(mockClaim).not.toHaveBeenCalled();
  });

  test("applies a new event once and marks it processed", async () => {
    const response = await postWebhook();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mockUpsertSubscriptionById).toHaveBeenCalledWith("sub_1");
    expect(mockComplete).toHaveBeenCalledWith("evt_1");
    expect(mockFail).not.toHaveBeenCalled();
  });

  test("returns 200 without applying side effects for a duplicate event.id", async () => {
    mockClaim.mockResolvedValueOnce({ kind: "duplicate" });

    const response = await postWebhook();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(mockUpsertSubscriptionById).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  test("returns 503 so Stripe retries while another isolate is in flight", async () => {
    mockClaim.mockResolvedValueOnce({ kind: "in_flight" });

    const response = await postWebhook();

    expect(response.status).toBe(503);
    expect(mockUpsertSubscriptionById).not.toHaveBeenCalled();
  });

  test("marks the event failed and returns 500 when apply throws", async () => {
    mockUpsertSubscriptionById.mockRejectedValueOnce(new Error("Stripe retrieve failed"));

    const response = await postWebhook();

    expect(response.status).toBe(500);
    expect(mockFail).toHaveBeenCalledWith("evt_1");
    expect(mockComplete).not.toHaveBeenCalled();
  });
});
