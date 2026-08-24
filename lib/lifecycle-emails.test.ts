import { describe, expect, test } from "vitest";

import { daysUntil, lifecycleEmailCopy } from "./lifecycle-emails";

describe("lifecycle email windows", () => {
  test("counts remaining UTC days for trial reminders", () => {
    expect(daysUntil("2026-08-25T12:00:00.000Z", new Date("2026-08-18T01:00:00.000Z"))).toBe(7);
    expect(daysUntil("2026-08-19T23:00:00.000Z", new Date("2026-08-18T01:00:00.000Z"))).toBe(1);
    expect(daysUntil("2026-08-18T08:00:00.000Z", new Date("2026-08-18T01:00:00.000Z"))).toBe(0);
  });

  test("keeps subscribe CTAs on tax-inclusive copy", () => {
    expect(lifecycleEmailCopy("trial_expired").html).toContain("tax is included");
    expect(lifecycleEmailCopy("payment_succeeded").subject).toContain("subscription is active");
  });

  test("tells newly activated students that an administrator opened the trial", () => {
    const copy = lifecycleEmailCopy("trial_activated");
    expect(copy.subject).toBe("Your Discover Keywords account is active");
    expect(copy.html).toContain("Account activated");
    expect(copy.html).toContain("administrator has opened your 90-day trial");
    expect(copy.html).toContain("/dashboard/opportunities");
  });
});
