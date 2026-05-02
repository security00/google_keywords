import { describe, test, expect } from "vitest";
import { createPasswordHash, verifyPassword } from "./auth";

describe("createPasswordHash", () => {
  test("produces scrypt format string", async () => {
    const hash = await createPasswordHash("testPassword123");
    const parts = hash.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toBe("16384"); // cost
    expect(parts[2]).toBe("8"); // blockSize
    expect(parts[3]).toBe("1"); // parallelization
  });

  test("different calls produce different salts", async () => {
    const h1 = await createPasswordHash("same");
    const h2 = await createPasswordHash("same");
    expect(h1).not.toBe(h2);
  });
});

describe("verifyPassword", () => {
  test("correct password verifies", async () => {
    const hash = await createPasswordHash("myP@ss123");
    expect(await verifyPassword("myP@ss123", hash)).toBe(true);
  });

  test("wrong password rejects", async () => {
    const hash = await createPasswordHash("myP@ss123");
    expect(await verifyPassword("wrongPass", hash)).toBe(false);
  });

  test("empty password rejects against real hash", async () => {
    const hash = await createPasswordHash("realPassword");
    expect(await verifyPassword("", hash)).toBe(false);
  });

  test("malformed stored hash returns false", async () => {
    expect(await verifyPassword("any", "not-a-valid-hash")).toBe(false);
  });

  test("wrong prefix returns false", async () => {
    expect(await verifyPassword("any", "bcrypt$16384$8$1$salt$hash")).toBe(false);
  });

  test("non-numeric cost returns false", async () => {
    expect(await verifyPassword("any", "scrypt$abc$8$1$salt$hash")).toBe(false);
  });
});
