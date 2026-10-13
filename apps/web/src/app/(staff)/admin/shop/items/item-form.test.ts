import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { durationOf } = await import("./item-form");

test("a duration is shown in the largest unit it divides into evenly", () => {
  expect(durationOf(null)).toBeNull();
  expect(durationOf(86_400 * 3)).toEqual({ amount: 3, unit: "days" });
  expect(durationOf(7_200)).toEqual({ amount: 2, unit: "hours" });
  expect(durationOf(5_400)).toEqual({ amount: 90, unit: "minutes" });
});

test("a duration that is not a whole number of minutes is shown exactly, in seconds", () => {
  expect(durationOf(90)).toEqual({ amount: 90, unit: "seconds" });
  expect(durationOf(61)).toEqual({ amount: 61, unit: "seconds" });
});
