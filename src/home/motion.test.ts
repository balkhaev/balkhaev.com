import { describe, expect, test } from "bun:test";
import { nearness, pullAt } from "./motion";

describe("black hole pull on the name", () => {
  test("letters next to the hole are pulled hardest, far ones barely", () => {
    const near = pullAt(10, 200, 1);
    const far = pullAt(900, 200, 1);
    expect(near).toBeGreaterThan(30);
    expect(near).toBeLessThanOrEqual(200 * 0.22);
    expect(far).toBeLessThan(2);
  });

  test("no pull without the pointer nearby", () => {
    expect(pullAt(10, 200, 0)).toBe(0);
    expect(nearness(10_000, 200)).toBe(0);
    expect(nearness(0, 200)).toBe(1);
  });
});
