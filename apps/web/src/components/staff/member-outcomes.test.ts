import { expect, test } from "bun:test";
import { outcomeTone } from "./member-outcomes";

test("the line that sums a run up is success only when every member was done", () => {
  expect(outcomeTone({ done: 3, skipped: 0, failed: 0 })).toBe("text-success");
  expect(outcomeTone({ done: 3, skipped: 1, failed: 0 })).toBe(
    "text-muted-foreground",
  );
  expect(outcomeTone({ done: 0, skipped: 2, failed: 0 })).toBe(
    "text-muted-foreground",
  );
  expect(outcomeTone({ done: 0, skipped: 0, failed: 0 })).toBe(
    "text-muted-foreground",
  );
});

test("any failure is destructive, whatever else was done", () => {
  expect(outcomeTone({ done: 0, skipped: 0, failed: 1 })).toBe(
    "text-destructive",
  );
  expect(outcomeTone({ done: 5, skipped: 2, failed: 1 })).toBe(
    "text-destructive",
  );
});
