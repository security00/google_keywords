import "server-only";

import type Stripe from "stripe";

// SaaS / business software. Confirm with a tax advisor before live launch.
// https://docs.stripe.com/tax/tax-codes
export const SAAS_PRODUCT_TAX_CODE = "txcd_10103001";

export const stripeCheckoutTaxParams = (): Pick<
  Stripe.Checkout.SessionCreateParams,
  | "automatic_tax"
  | "tax_id_collection"
  | "billing_address_collection"
  | "customer_update"
> => ({
  automatic_tax: { enabled: true },
  tax_id_collection: { enabled: true },
  billing_address_collection: "required",
  customer_update: {
    address: "auto",
    name: "auto",
  },
});
