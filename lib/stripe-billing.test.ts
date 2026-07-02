import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import {
  getStripeCustomerIdForUser,
  upsertStripeCustomerForUser,
} from "./stripe-billing";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

const mockD1Query = vi.mocked(d1Query);

describe("stripe billing customer mapping", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
  });

  test("reads the persisted Stripe customer before falling back to subscriptions", async () => {
    mockD1Query.mockResolvedValueOnce({
      rows: [{ stripe_customer_id: "cus_existing" }],
    });

    const customerId = await getStripeCustomerIdForUser("user-1");

    expect(customerId).toBe("cus_existing");
    expect(mockD1Query).toHaveBeenCalledTimes(1);
    expect(String(mockD1Query.mock.calls[0][0])).toContain("FROM stripe_customers");
  });

  test("falls back to subscription rows for users created before customer persistence", async () => {
    mockD1Query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_from_subscription" }] });

    const customerId = await getStripeCustomerIdForUser("user-1");

    expect(customerId).toBe("cus_from_subscription");
    expect(mockD1Query).toHaveBeenCalledTimes(2);
    expect(String(mockD1Query.mock.calls[1][0])).toContain("FROM saas_subscriptions");
  });

  test("upserts the Stripe customer mapping by user id", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [] });

    await upsertStripeCustomerForUser({
      userId: "user-1",
      email: "user@example.com",
      stripeCustomerId: "cus_new",
    });

    expect(String(mockD1Query.mock.calls[0][0])).toContain("ON CONFLICT(user_id) DO UPDATE");
    expect(mockD1Query.mock.calls[0][1]).toEqual([
      expect.any(String),
      "user-1",
      "cus_new",
      "user@example.com",
    ]);
  });
});
