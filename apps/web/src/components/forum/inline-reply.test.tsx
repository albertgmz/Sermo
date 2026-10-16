import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineReply } from "./inline-reply";

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
