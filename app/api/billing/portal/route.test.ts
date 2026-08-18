import { beforeEach, describe, expect, test, vi } from "vitest";

const mockGetAuthUser = vi.hoisted(() => vi.fn());
const mockGetStripeCustomerIdForUser = vi.hoisted(() => vi.fn());
const mockPortalCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getAuthUser: mockGetAuthUser,
}));

vi.mock("@/lib/stripe-billing", () => ({
  getAppUrl: () => "https://www.discoverkeywords.co",
  getStripeCustomerIdForUser: mockGetStripeCustomerIdForUser,
  getStripe: () => ({
    billingPortal: { sessions: { create: mockPortalCreate } },
  }),
}));

const { POST } = await import("./route");

describe("POST /api/billing/portal", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockGetStripeCustomerIdForUser.mockReset();
    mockPortalCreate.mockReset();
    mockGetAuthUser.mockResolvedValue({ id: "user-1", email: "owner@example.com" });
    mockGetStripeCustomerIdForUser.mockResolvedValue("cus_live_1");
    mockPortalCreate.mockResolvedValue({ url: "https://billing.stripe.com/session/live" });
  });

  test("creates a portal session for the stored customer", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://billing.stripe.com/session/live",
    });
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: "cus_live_1",
      return_url: "https://www.discoverkeywords.co/dashboard/settings",
    });
  });

  test("returns 404 when the user has no customer mapping", async () => {
    mockGetStripeCustomerIdForUser.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(404);
    expect(mockPortalCreate).not.toHaveBeenCalled();
  });

  test("returns 404 instead of 500 when the stored customer is stale", async () => {
    mockPortalCreate.mockRejectedValue(
      Object.assign(new Error("No such customer: 'cus_stale_test'"), { statusCode: 404 })
    );

    const response = await POST();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "No Stripe customer found" });
  });

  test("returns 500 for unexpected Stripe errors", async () => {
    mockPortalCreate.mockRejectedValue(Object.assign(new Error("stripe down"), { statusCode: 500 }));

    const response = await POST();

    expect(response.status).toBe(500);
  });
});
