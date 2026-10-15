import { expect, test } from "bun:test";
import { readResult, resultQuery } from "./result";

const params = (query: string) =>
  Object.fromEntries(new URLSearchParams(query));

const answer = (
  items: {
    name: string;
    status: "done" | "skipped" | "failed";
    message: string | null;
  }[],
) => ({
  items,
  done: items.filter((item) => item.status === "done").length,
  skipped: items.filter((item) => item.status === "skipped").length,
  failed: items.filter((item) => item.status === "failed").length,
});

test("a result goes into an address and comes back out", () => {
  const sent = answer([
    { name: "wren", status: "done", message: null },
    { name: "robin", status: "skipped", message: "Outranks you." },
    { name: "jay", status: "failed", message: null },
  ]);
  expect(readResult(params(resultQuery("reject", sent)))).toEqual({
    decision: "reject",
    done: 1,
    skipped: 1,
    failed: 1,
    lines: [
      { status: "skipped", name: "robin", message: "Outranks you." },
      { status: "failed", name: "jay", message: "" },
    ],
  });
});

test("an address carries few lines of limited length, and the counts say the rest", () => {
  const many = answer(
    Array.from({ length: 30 }, (_, index) => ({
      name: `member-${index}`.padEnd(200, "x"),
      status: "skipped" as const,
      message: "m".repeat(500),
    })),
  );
  const query = resultQuery("approve", many);
  const result = readResult(params(query));
  expect(result?.skipped).toBe(30);
  expect(result?.lines.length).toBeLessThanOrEqual(10);
  expect(result?.lines[0]?.name).toHaveLength(64);
  expect(result?.lines[0]?.message).toHaveLength(200);
  expect(query.length).toBeLessThanOrEqual(3000);
});

test("the query is bounded in size: lines are dropped, last first, until it fits", () => {
  // Ten lines of the longest text with characters that grow when encoded.
  const heavy = answer(
    Array.from({ length: 10 }, (_, index) => ({
      name: `${index}`.padEnd(64, "é"),
      status: "failed" as const,
      message: "é&=ñ".repeat(50),
    })),
  );
  const query = resultQuery("reject", heavy);
  expect(query.length).toBeLessThanOrEqual(3000);
  const result = readResult(params(query));
  expect(result?.failed).toBe(10);
  expect(result?.lines.length).toBeGreaterThan(0);
  expect(result?.lines.length).toBeLessThan(10);
  // The lines kept are the first ones.
  expect(result?.lines[0]?.name.startsWith("0")).toBe(true);
});

test("only a well-formed result is read back", () => {
  const good = { decided: "approve", done: "1", skipped: "0", failed: "0" };
  expect(readResult(good)).not.toBeNull();
  expect(readResult({ ...good, decided: "x" })).toBeNull();
  expect(readResult({ ...good, done: "-1" })).toBeNull();
  expect(readResult({ ...good, done: "1e3" })).toBeNull();
  expect(readResult({ ...good, failed: undefined })).toBeNull();
  // Lines that are not JSON, not a list or not of the right kind are dropped, the counts stay.
  expect(readResult({ ...good, lines: "{" })?.lines).toEqual([]);
  expect(readResult({ ...good, lines: '{"a":1}' })?.lines).toEqual([]);
  expect(
    readResult({
      ...good,
      lines: JSON.stringify([
        ["done", "a", "b"],
        ["failed", 1, "b"],
        "x",
        ["skipped", "a", "b"],
      ]),
    })?.lines,
  ).toEqual([{ status: "skipped", name: "a", message: "b" }]);
});
