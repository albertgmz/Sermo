import { expect, test } from "bun:test";
import { effectOf, firstChoiceEffect } from "./effects";

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

test("a first choice that accepts something refreshes the page, one that accepts nothing leaves it", () => {
  expect(firstChoiceEffect(false, ["necessary", "embeds"])).toBe("refresh");
  expect(firstChoiceEffect(false, ["necessary", "referrals"])).toBe("refresh");
  expect(firstChoiceEffect(false, ["necessary"])).toBe("none");
});

test("a visitor who was not asked had everything on, so what they leave off is a withdrawal", () => {
  const all = ["necessary", "analytics", "referrals", "embeds"];
  // Keeping everything changes nothing.
  expect(firstChoiceEffect(true, all)).toBe("none");
  expect(firstChoiceEffect(true, ["necessary", "analytics", "embeds"])).toBe(
    "none",
  );
  // Turning the tag or the players off needs a fresh page; turning referrals off alone does not.
  expect(firstChoiceEffect(true, ["necessary"])).toBe("reload");
  expect(firstChoiceEffect(true, ["necessary", "referrals", "embeds"])).toBe(
    "reload",
  );
  expect(firstChoiceEffect(true, ["necessary", "analytics", "embeds"])).toBe(
    "none",
  );
});

test("a category the banner does not offer is not a withdrawal when the visitor leaves it off", () => {
  // Statistics without cookies take no choice, so "accept all" cannot have it among the accepted.
  const offered = ["necessary", "referrals", "embeds"];
  expect(firstChoiceEffect(true, offered, ["analytics"])).toBe("none");
  expect(firstChoiceEffect(true, ["necessary"], ["analytics"])).toBe("reload");
  expect(firstChoiceEffect(true, offered)).toBe("reload");
});
