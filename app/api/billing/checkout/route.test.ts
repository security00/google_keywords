import { beforeEach, describe, expect, test, vi } from "vitest";

const mockGetAuthUser = vi.hoisted(() => vi.fn());
const mockCreateStripeCustomerForUser = vi.hoisted(() => vi.fn());
const mockSessionsCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getAuthUser: mockGetAuthUser,
}));

vi.mock("@/lib/stripe-billing", () => ({
  createStripeCustomerForUser: mockCreateStripeCustomerForUser,
  getAppUrl: () => "https://www.discoverkeywords.co",
  getFoundingPriceId: () => "price_test_founding",
  getStripe: () => ({
    checkout: { sessions: { create: mockSessionsCreate } },
  }),
}));

const { POST } = await import("./route");

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockCreateStripeCustomerForUser.mockReset();
    mockSessionsCreate.mockReset();
    mockGetAuthUser.mockResolvedValue({ id: "user-1", email: "owner@example.com" });
    mockCreateStripeCustomerForUser.mockResolvedValue("cus_test");
    mockSessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_test" });
  });

  test("creates a tax-inclusive subscription checkout session", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_test",
    });
    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_test",
        automatic_tax: { enabled: true },
        tax_id_collection: { enabled: true },
        billing_address_collection: "required",
        customer_update: {
          address: "auto",
          name: "auto",
        },
        line_items: [{ price: "price_test_founding", quantity: 1 }],
      })
    );
  });
});
