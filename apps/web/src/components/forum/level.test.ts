import { expect, test } from "bun:test";
import { levelWithBounds } from "./level";

test("the fill of a level bar stays within its bounds", () => {
  expect(levelWithBounds(2, 150, 100, 300).progress).toBe(0.25);
  expect(levelWithBounds(2, 50, 100, 300).progress).toBe(0);
  expect(levelWithBounds(2, 900, 100, 300).progress).toBe(1);
  expect(levelWithBounds(1, 0, 0, 0).progress).toBe(0);
});

test("a level keeps the numbers the backend gave", () => {
  expect(levelWithBounds(3, 350, 300, 600)).toEqual({
    level: 3,
    xp: 350,
    currentLevelXp: 300,
    nextLevelXp: 600,
    progress: 50 / 300,
  });
});
