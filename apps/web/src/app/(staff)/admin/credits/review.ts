import { creditsAdjust } from "@sermo/core/contracts";

// What the backend would refuse in an adjustment, read from the contract's own input schema so the
// review step can say it before anything is confirmed: the range of the amount, a zero, a reason
// that is too long. Null when the contract accepts it.
export function adjustmentRefusal(
  userId: number,
  amount: number,
  reason: string,
): string | null {
  const parsed = creditsAdjust.input.safeParse({ userId, amount, reason });
  if (parsed.success) return null;
  return parsed.error.issues.map((issue) => issue.message).join(" ");
}
