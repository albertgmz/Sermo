import { expect, test } from "bun:test";
import { adjustmentRefusal } from "./review";

test("an amount the contract refuses is told before the confirmation", () => {
  expect(adjustmentRefusal(4, 30, "Refund")).toBeNull();
  expect(adjustmentRefusal(4, -1_000_000_000, "Refund")).toBeNull();
  expect(adjustmentRefusal(4, 0, "Refund")).toBe("The amount cannot be 0.");
  expect(adjustmentRefusal(4, 1_000_000_001, "Refund")).toContain("1000000000");
  expect(adjustmentRefusal(4, -1_000_000_001, "Refund")).not.toBeNull();
});

test("a reason that is too long is refused too", () => {
  expect(adjustmentRefusal(4, 5, "x".repeat(501))).not.toBeNull();
});
