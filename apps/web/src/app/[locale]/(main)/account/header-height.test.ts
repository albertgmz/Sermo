import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) =>
  readFileSync(join(import.meta.dir, file), "utf8");

test("the account header keeps its tall box only for a member who has a cover to show", () => {
  const layout = read("layout.tsx");
  // The one place the height is set, and the condition that sets it.
  expect(layout.match(/min-h-40/g)).toHaveLength(1);
  expect(layout).toMatch(/author\.cover && "min-h-40 sm:min-h-48"/);
  // Its placeholder is the usual card, without a cover: no fixed height either.
  expect(
    read("../../../../components/forum/skeletons.tsx").match(/min-h-40/g),
  ).toBeNull();
});
