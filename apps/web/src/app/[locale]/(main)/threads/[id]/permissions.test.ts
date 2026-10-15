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

test("deleting for good follows its own flag, which alone shows the moderation menu", () => {
  expect(threadMay({ "forum.hardDelete": true }).hardDelete).toBe(true);
  expect(threadMay({ "forum.hardDelete": true }).any).toBe(true);
  expect(threadMay({ "forum.deleteAny": true }).hardDelete).toBe(false);
});

test("the thread's own answer decides deleting for good, hiding and locking alone when it is there", () => {
  // An administrator holds forum.hardDelete everywhere, yet the backend refuses it on a live
  // thread of another member: the menu must not offer what it will refuse.
  const admin = {
    "forum.hardDelete": true,
    "forum.deleteAny": true,
    "forum.lock": true,
  };
  const live = { canHardDelete: false, canDelete: true, canLock: true };
  expect(threadMay(admin, live).hardDelete).toBe(false);
  expect(threadMay(admin, { ...live, canHardDelete: true }).hardDelete).toBe(
    true,
  );
  expect(threadMay(admin, { ...live, canDelete: false }).delete).toBe(false);
  expect(threadMay(admin, { ...live, canLock: false }).lock).toBe(false);
  // An author holds none of these permissions in the resolved set; the answer grants them.
  expect(
    threadMay({}, { canHardDelete: true, canDelete: true, canLock: true }),
  ).toMatchObject({
    hardDelete: true,
    delete: true,
    lock: true,
    any: true,
  });
  // Without the thread's answer (the edit page), the resolved permissions speak.
  expect(threadMay(admin).hardDelete).toBe(true);
});
