import { expect, test } from "bun:test";
import { referralStep } from "./cookie";

const ORIGIN = "https://forum.test";

test("the canonical address is the path and query without ref, on the site's own origin", () => {
  const step = (address: string) =>
    referralStep(new URL(address), {}, true, ORIGIN).canonical;
  expect(step("https://x.test/forums?ref=3")).toBe("https://forum.test/forums");
  expect(step("https://x.test/forums?page=2&ref=3")).toBe(
    "https://forum.test/forums?page=2",
  );
  expect(step("https://x.test/forums")).toBeNull();
  // A path that starts with two slashes is not a host.
  expect(step("https://x.test//evil.test/x?ref=3")).toBe(
    "https://forum.test/evil.test/x",
  );
});
