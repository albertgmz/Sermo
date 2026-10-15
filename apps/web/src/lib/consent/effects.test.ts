import { expect, test } from "bun:test";
import { effectOf } from "./effects";

test("withdrawing analytics or embeds reloads the page, whatever else changed", () => {
  expect(effectOf(["analytics"], ["necessary"])).toBe("reload");
  expect(effectOf(["embeds"], ["necessary", "analytics"])).toBe("reload");
  expect(effectOf(["analytics", "embeds"], ["necessary", "embeds"])).toBe(
    "reload",
  );
});

test("accepting analytics or embeds refreshes the page so the server draws them", () => {
  expect(effectOf(["analytics"], ["necessary", "analytics"])).toBe("refresh");
  expect(effectOf(["embeds"], ["necessary", "embeds"])).toBe("refresh");
});

test("a change that shows nothing leaves the page alone", () => {
  expect(effectOf(["referrals"], ["necessary", "referrals"])).toBe("none");
  expect(effectOf(["referrals"], ["necessary"])).toBe("none");
  expect(effectOf([], ["necessary"])).toBe("none");
});
