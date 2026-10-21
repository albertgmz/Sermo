import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { LineComposer } from "./line-composer";

const attach = messages.forum.attachmentField.attach;
const nothing = async () => ({});

const draw = (withFiles: boolean) =>
  renderToStaticMarkup(
    withIntl(
      <LineComposer
        action={nothing}
        placeholder="Escribe un comentario…"
        submitLabel="Comentar mensaje"
        attach={withFiles}
      />,
    ),
  );

test("before it is entered it is one line, with its buttons out of the way", () => {
  const html = draw(true);
  expect(html).toContain("<textarea");
  expect(html).toContain("min-height:40px");
  const row = html.match(/<div class="([^"]*)"><div class="contents">/);
  expect(row?.[1].split(" ")).toContain("hidden");
});

test("the text takes the whole width: nothing sits beside it, and the submit is labelled", () => {
  const html = draw(true);
  const field = html.indexOf("<textarea");
  // No arrow and no bare paperclip in the line of the text.
  expect(html.slice(0, field)).not.toContain("<button");
  expect(html.slice(0, field)).not.toContain("<label");
  expect(html).not.toContain("lucide-send");
  expect(html).not.toContain("rounded-4xl");
  expect(html).toMatch(/<\/svg>Comentar mensaje<\/button>/);
});

test("a comment with files has Attach files after its submit; a reply has none", () => {
  const comment = draw(true);
  expect(comment).toContain(`</svg>${attach}<input`);
  const submit = comment.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
  expect(submit).not.toContain("order-last");
  const reply = draw(false);
  expect(reply).not.toContain(attach);
  expect(reply.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain(
    "ml-auto",
  );
});

test("once a comment is in the page the box starts over as one line", () => {
  const source = readFileSync(
    join(import.meta.dir, "line-composer.tsx"),
    "utf8",
  );
  expect(source).toMatch(
    /if \(!state\.landOn\) return;\s*landOn\(state\.landOn\);\s*setEntered\(false\);\s*setSent/,
  );
  expect(source).toContain("key={sent}");
});
