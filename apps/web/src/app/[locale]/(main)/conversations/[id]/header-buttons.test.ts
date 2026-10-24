import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The header of a conversation (bookmark, mark as unread, leave) shows each button's word on a
// phone too: an icon alone does not say what it does.
test("no header button of a conversation hides its word on a phone", () => {
  const page = readFileSync(join(import.meta.dir, "page.tsx"), "utf8");
  const header = page.slice(
    page.indexOf("function Header("),
    page.indexOf("export default"),
  );
  expect(header).toContain("<BookmarkButton");
  expect(header).not.toContain("sr-only");
});
