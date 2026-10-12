import { describe, expect, test } from "bun:test";
import { levelFor, levelTitle } from "./levels";

describe("levelFor", () => {
  test("level boundaries with step 100", () => {
    expect(levelFor(0, 100)).toEqual({ level: 1, currentLevelXp: 0, nextLevelXp: 100 });
    expect(levelFor(99, 100)).toEqual({ level: 1, currentLevelXp: 0, nextLevelXp: 100 });
    expect(levelFor(100, 100)).toEqual({ level: 2, currentLevelXp: 100, nextLevelXp: 300 });
    expect(levelFor(299, 100)).toEqual({ level: 2, currentLevelXp: 100, nextLevelXp: 300 });
    expect(levelFor(300, 100)).toEqual({ level: 3, currentLevelXp: 300, nextLevelXp: 600 });
    expect(levelFor(599, 100).level).toBe(3);
    expect(levelFor(600, 100).level).toBe(4);
  });
  test("every boundary and the XP just below it, for several steps", () => {
    for (const step of [1, 7, 100, 12345])
      for (let n = 2; n < 400; n++) {
        const start = (step * n * (n - 1)) / 2;
        expect(levelFor(start, step).level).toBe(n);
        expect(levelFor(start - 1, step).level).toBe(n - 1);
      }
  });
  test("a very large XP is computed without looping over levels", () => {
    const info = levelFor(1e15, 100);
    expect(info.currentLevelXp).toBeLessThanOrEqual(1e15);
    expect(info.nextLevelXp).toBeGreaterThan(1e15);
    expect(info.level).toBeGreaterThan(1e6);
    expect(info.nextLevelXp - info.currentLevelXp).toBe(info.level * 100);
  });
  test("negative XP counts as zero", () => {
    expect(levelFor(-5, 100).level).toBe(1);
  });
});

describe("levelTitle", () => {
  const titles = [
    { level: 4, title: "Senior" },
    { level: 1, title: "New" },
    { level: 2, title: "Member" },
  ];
  test("the entry with the highest level not above the member's", () => {
    expect(levelTitle(1, titles)).toBe("New");
    expect(levelTitle(3, titles)).toBe("Member");
    expect(levelTitle(4, titles)).toBe("Senior");
    expect(levelTitle(99, titles)).toBe("Senior");
  });
  test("empty when none applies", () => {
    expect(levelTitle(1, [{ level: 2, title: "x" }])).toBe("");
    expect(levelTitle(5, [])).toBe("");
  });
});
