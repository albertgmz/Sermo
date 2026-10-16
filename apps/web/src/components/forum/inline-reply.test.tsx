import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineReply } from "./inline-reply";

const source = readFileSync(join(import.meta.dir, "inline-reply.tsx"), "utf8");

const draw = () =>
  renderToStaticMarkup(
    <InlineReply
      action={async () => ({})}
      label="Reply"
      placeholder="Write a reply…"
      submitLabel="Post reply"
      anchor="feed-post-31-comment"
    />,
  );

test("the card holds a closed Reply button and nothing of the box", () => {
  const html = draw();
  expect(html).toContain('aria-label="Reply"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("feed-post-31-comment");
  expect(html).not.toContain("Write a reply…");
});

test("the composer is never imported for its code: only as a type, and by a dynamic import", () => {
  const imports = [...source.matchAll(/^import .*from "([^"]+)"/gm)];
  const composer = imports.filter(([line]) =>
    line.includes("@/components/forum/line-composer"),
  );
  expect(composer.length).toBeGreaterThan(0);
  for (const [line] of composer)
    expect(line.startsWith("import type")).toBe(true);
  expect(source).toContain('import("@/components/forum/line-composer")');
});

test("a box that was opened stays mounted, hidden, when it is closed, so a draft is not lost", () => {
  expect(source).toContain("hidden={!open}");
  expect(source).toContain("{opened && (");
});
