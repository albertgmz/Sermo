import { expect, test } from "bun:test";
import { mayRestore, threadMay } from "./permissions";

test("a control follows the flag the backend resolved", () => {
  const may = threadMay({
    "forum.stick": true,
    "forum.feature": true,
    "forum.lock": false,
    "forum.move": 1,
    "forum.undelete": true,
  });
  expect(may.stick).toBe(true);
  expect(may.feature).toBe(true);
  expect(may.lock).toBe(false);
  // Only a flag set to true counts.
  expect(may.move).toBe(false);
  expect(may.merge).toBe(false);
  expect(may.any).toBe(true);
});

test("featuring alone is enough to show the moderation menu", () => {
  expect(threadMay({ "forum.feature": true }).any).toBe(true);
  expect(threadMay({ "forum.feature": false }).any).toBe(false);
});

test("the moderation menu is not shown when nothing applies", () => {
  expect(
    threadMay({ "forum.reply": true, "forum.uploadAttachments": true }).any,
  ).toBe(false);
  expect(threadMay({}).any).toBe(false);
});

test("a post or thread is brought back by the flag of its state", () => {
  const undeleter = threadMay({ "forum.undelete": true });
  const approver = threadMay({ "forum.approve": true });
  expect(mayRestore(undeleter, "deleted")).toBe(true);
  expect(mayRestore(undeleter, "moderated")).toBe(false);
  expect(mayRestore(approver, "moderated")).toBe(true);
  expect(mayRestore(approver, "deleted")).toBe(false);
  expect(mayRestore(undeleter, "visible")).toBe(false);
});
