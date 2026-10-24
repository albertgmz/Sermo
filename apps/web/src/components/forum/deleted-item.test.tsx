import { afterAll, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// A server render cannot press a button: the item's own reducer is run here as many times as the
// toggle was pressed, and the item is drawn in the state that leads to.
const react = await import("react");
let presses = 0;
mock.module("react", () => ({
  ...react,
  useReducer: <S,>(reducer: (state: S) => S, initial: S) => {
    let state = initial;
    for (let press = 0; press < presses; press += 1) state = reducer(state);
    return [state, () => {}];
  },
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
afterAll(() => {
  mock.module("react", () => react);
  mock.module("next-intl", () => intl);
});
const { DeletedItem } = await import("./deleted-item");
const { DeletionNotice } = await import("./deletion-notice");

const deletion = {
  by: { username: "kestrel" },
  reason: "Spam",
  at: "2026-01-02T00:00:00.000Z",
};

async function drawn(
  pressed: number,
  record: Parameters<typeof DeletionNotice>[0]["deletion"] = deletion,
) {
  presses = pressed;
  const notice = (
    <DeletionNotice
      deletion={record}
      fallback="This was deleted."
      tools={<button type="button">Restore</button>}
    />
  );
  const stream = await renderToReadableStream(
    withIntl(
      <DeletedItem collapsed={<div data-folded="">{notice}</div>}>
        <article>
          {notice}
          <p>the deleted text</p>
        </article>
      </DeletedItem>,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("a deleted item is drawn folded: who deleted it, when, why, Show… and its tools, not its text", async () => {
  const html = await drawn(0);
  expect(html).toContain("data-folded");
  expect(html).not.toContain("the deleted text");
  expect(html).toContain("Deleted by kestrel");
  expect(html).toContain('dateTime="2026-01-02T00:00:00.000Z"');
  expect(html).toContain("Reason: Spam");
  expect(html).toMatch(/<button type="button"[^>]*aria-expanded="false"/);
  expect(html).toContain("Show…");
  expect(html).toContain(">Restore<");
});

test("an item a deleted member hid themselves is deleted by the guest word", async () => {
  const html = await drawn(0, {
    ...deletion,
    by: { kind: "guest", name: null },
  });
  expect(html).toContain("Deleted by Guest");
});

test("Show opens the whole item in its place, and Hide folds it again", async () => {
  const open = await drawn(1);
  expect(open).not.toContain("data-folded");
  expect(open).toContain("the deleted text");
  expect(open).toContain("Deleted by kestrel");
  expect(open).toMatch(/aria-expanded="true"[^>]*>Hide</);
  expect(open).toContain(">Restore<");

  const folded = await drawn(2);
  expect(folded).toContain("data-folded");
  expect(folded).not.toContain("the deleted text");
  expect(folded).toContain("Show…");
});

test("an item no record names a deleter for keeps its own line", async () => {
  const html = await drawn(0, null);
  expect(html).toContain("This was deleted.");
  expect(html).not.toContain("Deleted by");
  expect(html).not.toContain("Reason:");
  expect(html).toContain("Show…");
});
