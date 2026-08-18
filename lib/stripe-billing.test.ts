import { beforeEach, describe, expect, test, vi } from "vitest";

import { d1Query } from "@/lib/d1";
import {
  createStripeCustomerForUser,
  getStripeCustomerIdForUser,
  upsertStripeCustomerForUser,
} from "./stripe-billing";

vi.mock("@/lib/d1", () => ({
  d1Query: vi.fn(),
}));

const mockCustomersRetrieve = vi.hoisted(() => vi.fn());
const mockCustomersCreate = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => ({
  default: class MockStripe {
    static createFetchHttpClient() {
      return undefined;
    }
    customers = { retrieve: mockCustomersRetrieve, create: mockCustomersCreate };
  },
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

describe("createStripeCustomerForUser", () => {
  beforeEach(() => {
    mockD1Query.mockReset();
    mockCustomersRetrieve.mockReset();
    mockCustomersCreate.mockReset();
    process.env.STRIPE_SECRET_KEY = "rk_test_dummy";
  });

  test("reuses the stored customer when it exists in the current Stripe account", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_live_ok" }] });
    mockCustomersRetrieve.mockResolvedValueOnce({ id: "cus_live_ok" });

    const customerId = await createStripeCustomerForUser({ userId: "user-1", email: "user@example.com" });

    expect(customerId).toBe("cus_live_ok");
    expect(mockCustomersCreate).not.toHaveBeenCalled();
  });

  test("recreates the customer when the stored mapping is stale (404)", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_stale_test" }] });
    mockCustomersRetrieve.mockRejectedValueOnce(Object.assign(new Error("No such customer"), { statusCode: 404 }));
    mockCustomersCreate.mockResolvedValueOnce({ id: "cus_new_live" });
    mockD1Query.mockResolvedValueOnce({ rows: [] });

    const customerId = await createStripeCustomerForUser({ userId: "user-1", email: "user@example.com" });

    expect(customerId).toBe("cus_new_live");
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: "user@example.com",
      metadata: { user_id: "user-1" },
    });
    expect(String(mockD1Query.mock.calls[1][0])).toContain("ON CONFLICT(user_id) DO UPDATE");
    expect(mockD1Query.mock.calls[1][1]).toContain("cus_new_live");
  });

  test("recreates the customer when the stored one was deleted", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_deleted" }] });
    mockCustomersRetrieve.mockResolvedValueOnce({ id: "cus_deleted", deleted: true });
    mockCustomersCreate.mockResolvedValueOnce({ id: "cus_fresh" });
    mockD1Query.mockResolvedValueOnce({ rows: [] });

    const customerId = await createStripeCustomerForUser({ userId: "user-1", email: "user@example.com" });

    expect(customerId).toBe("cus_fresh");
  });

  test("rethrows unexpected Stripe errors instead of duplicating customers", async () => {
    mockD1Query.mockResolvedValueOnce({ rows: [{ stripe_customer_id: "cus_live_ok" }] });
    mockCustomersRetrieve.mockRejectedValueOnce(Object.assign(new Error("stripe down"), { statusCode: 500 }));

    await expect(
      createStripeCustomerForUser({ userId: "user-1", email: "user@example.com" })
    ).rejects.toThrow("stripe down");
    expect(mockCustomersCreate).not.toHaveBeenCalled();
  });
});
