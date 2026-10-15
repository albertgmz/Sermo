import { expect, test } from "bun:test";
import { rejectOptions } from "./reject-options";

const viewer = (held: Record<string, boolean | number>) => ({
  resolvedPermissions: held,
  staff: { panel: true, moderatesEverywhere: false, moderatedNodeIds: [] },
});

test("a bound of -1 allows a ban for good, and any other bound limits the days", () => {
  expect(
    rejectOptions(viewer({ "member.ban": true, "member.banMaxDays": -1 })).ban,
  ).toEqual({
    forever: true,
    maxDays: 3650,
  });
  expect(
    rejectOptions(viewer({ "member.ban": true, "member.banMaxDays": 30 })).ban,
  ).toEqual({
    forever: false,
    maxDays: 30,
  });
  // A bound past what the backend takes is capped.
  expect(
    rejectOptions(viewer({ "member.ban": true, "member.banMaxDays": 9999 })).ban
      ?.maxDays,
  ).toBe(3650);
});

test("a bound of 0, or no ban permission, offers no ban; an unset bound is 30", () => {
  expect(
    rejectOptions(viewer({ "member.ban": true, "member.banMaxDays": 0 })).ban,
  ).toBeNull();
  expect(rejectOptions(viewer({ "member.banMaxDays": -1 })).ban).toBeNull();
  expect(rejectOptions(viewer({ "member.ban": true })).ban).toEqual({
    forever: false,
    maxDays: 30,
  });
});

test("erasing needs admin.members", () => {
  expect(rejectOptions(viewer({ "admin.members": true })).erase).toBe(true);
  expect(rejectOptions(viewer({})).erase).toBe(false);
});
