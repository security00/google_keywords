import { describe, expect, test } from "vitest";

import { SAAS_PRODUCT_TAX_CODE, stripeCheckoutTaxParams } from "./stripe-tax";

describe("Stripe checkout tax params", () => {
  test("enables automatic tax and collects an address for inclusive pricing", () => {
    expect(SAAS_PRODUCT_TAX_CODE).toBe("txcd_10103001");
    expect(stripeCheckoutTaxParams()).toEqual({
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      customer_update: {
        address: "auto",
        name: "auto",
      },
    });
  });
});
