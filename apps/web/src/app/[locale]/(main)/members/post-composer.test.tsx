import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The composer hands on the mention lookup, a server action.
mock.module("server-only", () => ({}));

const { PostComposer } = await import("./post-composer");

test("on the page the composer is the avatar, a pill and the file button, with no field of its own", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <PostComposer
        action={async () => ({})}
        avatar={<span>EM</span>}
        name="ember"
        placeholder="What's on your mind?"
      />,
    ),
  );
  expect(html).toContain("<span>EM</span>");
  expect(html).toMatch(
    /<button[^>]*rounded-full[^>]*>What&#x27;s on your mind\?/,
  );
  expect(html.match(/<button/g)).toHaveLength(2);
  expect(html).not.toContain("<textarea");
  expect(html).not.toContain("contenteditable");
});
