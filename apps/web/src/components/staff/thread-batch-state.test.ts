import { expect, test } from "bun:test";
import { batchActionsFor } from "./thread-batch-state";

test("a viewer is offered the changes their forum permissions allow", () => {
  expect(batchActionsFor({})).toEqual([]);
  expect(batchActionsFor({ "forum.lock": true, "forum.stick": false })).toEqual(
    ["lock", "unlock"],
  );
  // Only a flag set to true counts.
  expect(batchActionsFor({ "forum.move": 1 })).toEqual([]);
  expect(batchActionsFor({ "forum.approve": true })).toEqual(["restore"]);
  expect(batchActionsFor({ "forum.undelete": true })).toEqual(["restore"]);
  expect(
    batchActionsFor({
      "forum.deleteAny": true,
      "forum.feature": true,
      "forum.editAny": true,
      "forum.move": true,
    }),
  ).toEqual(["feature", "unfeature", "delete", "move", "setPrefix"]);
});
