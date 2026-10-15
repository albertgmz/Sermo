import { expect, test } from "bun:test";
import {
  APPROVAL_PENDING_MESSAGE,
  APPROVAL_PENDING_PATH,
} from "@sermo/core/contracts";
import {
  APPROVAL_ISSUE_PATH,
  APPROVAL_PENDING_DIGEST,
  RATE_LIMITED_DIGEST,
  SermoError,
} from "./errors";

test("the issue path the web app looks for is the one the contracts name", () => {
  expect(APPROVAL_ISSUE_PATH).toBe(APPROVAL_PENDING_PATH);
});

test("a refusal for an account waiting for approval reaches the error screen as its own digest", () => {
  const refusal = new SermoError("forbidden", 403, APPROVAL_PENDING_MESSAGE, [
    { path: [APPROVAL_PENDING_PATH], message: "awaiting" },
  ]);
  expect(refusal.digest).toBe(APPROVAL_PENDING_DIGEST);
});

test("no other refusal takes that digest", () => {
  expect(new SermoError("forbidden", 403, "No.").digest).toBeUndefined();
  expect(
    new SermoError("forbidden", 403, "No.", [{ path: ["acceptance"] }]).digest,
  ).toBeUndefined();
  expect(
    new SermoError("validation", 422, "No.", [{ path: ["approval"] }]).digest,
  ).toBeUndefined();
  expect(new SermoError("rate_limited", 429, "Slow down.").digest).toBe(
    RATE_LIMITED_DIGEST,
  );
});
