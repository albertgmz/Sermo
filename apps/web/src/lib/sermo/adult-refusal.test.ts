import { expect, test } from "bun:test";
// The backend's own constants, from the one file that holds them (the package's entry would load
// the whole backend).
import {
  ADULT_REFUSAL_PATH,
  ADULT_REFUSALS,
} from "../../../../../packages/core/src/errors";
import {
  ADULT_ISSUE_PATH,
  ADULT_REASONS,
  adultReasonOfDigest,
  SermoError,
} from "./errors";

test("the issue path and the reasons the web app looks for are the backend's", () => {
  expect(ADULT_ISSUE_PATH).toBe(ADULT_REFUSAL_PATH);
  expect([...ADULT_REASONS]).toEqual([...ADULT_REFUSALS]);
});

test("a +18 refusal reaches the error screen as a digest that names its reason", () => {
  for (const reason of ADULT_REASONS) {
    const refusal = new SermoError("forbidden", 403, "For adults.", [
      { path: [ADULT_ISSUE_PATH], message: reason },
    ]);
    expect(adultReasonOfDigest(refusal.digest)).toBe(reason);
  }
});

test("any other refusal, or a reason the web app does not know, is not one", () => {
  const plain = new SermoError("forbidden", 403, "No.", [
    { path: ["title"], message: "guest" },
  ]);
  expect(adultReasonOfDigest(plain.digest)).toBeNull();
  const unknown = new SermoError("forbidden", 403, "For adults.", [
    { path: [ADULT_ISSUE_PATH], message: "elsewhere" },
  ]);
  expect(adultReasonOfDigest(unknown.digest)).toBeNull();
  const missing = new SermoError("not_found", 404, "Gone.", [
    { path: [ADULT_ISSUE_PATH], message: "guest" },
  ]);
  expect(adultReasonOfDigest(missing.digest)).toBeNull();
  expect(adultReasonOfDigest(undefined)).toBeNull();
  expect(adultReasonOfDigest("sermo.adult.everyone")).toBeNull();
});
