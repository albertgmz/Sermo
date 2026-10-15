import { expect, test } from "bun:test";
import type { ListPage } from "@/lib/list-pages";
import { SermoError } from "./errors";
import { endQuietly, endsTheList } from "./list-actions";

const page: ListPage = { rows: [{ key: "a", node: null }], nextCursor: "c" };

test("a page that was read is handed on as it is", async () => {
  expect(await endQuietly(async () => page)).toBe(page);
});

test("a cursor the backend no longer follows, or a session that is gone, ends the list with an empty page", async () => {
  for (const code of ["not_found", "unauthenticated", "validation"]) {
    const ended = await endQuietly(async () => {
      throw new SermoError(code, 400, "no");
    });
    expect(ended.rows).toHaveLength(0);
    expect(ended.nextCursor).toBeNull();
    expect(endsTheList(code)).toBe(true);
  }
});

test("any other failure is raised so the list can offer to try again", async () => {
  for (const [code, status] of [
    ["rate_limited", 429],
    ["internal", 500],
    ["forbidden", 403],
  ] as const) {
    let raised = false;
    await endQuietly(async () => {
      throw new SermoError(code, status, "down");
    }).catch(() => {
      raised = true;
    });
    expect(raised, code).toBe(true);
    expect(endsTheList(code)).toBe(false);
  }
  let plain = false;
  await endQuietly(async () => {
    throw new Error("boom");
  }).catch(() => {
    plain = true;
  });
  expect(plain).toBe(true);
});
