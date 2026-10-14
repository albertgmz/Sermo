import { expect, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { SaveStatus } from "@/components/forum/autosave";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

async function markup(element: React.ReactNode) {
  return new Response(await renderToReadableStream(withIntl(element))).text();
}

const t = messages.forum.autosave;

test("each state of a setting says what is happening", async () => {
  expect(await markup(<SaveStatus state={{ phase: "idle" }} />)).not.toMatch(
    /Saving|Saved|Undo/,
  );
  expect(await markup(<SaveStatus state={{ phase: "saving" }} />)).toContain(
    t.saving,
  );
  const saved = await markup(
    <SaveStatus state={{ phase: "saved", undo: false }} onUndo={() => {}} />,
  );
  expect(saved).toContain(t.saved);
  expect(saved).not.toContain(t.undo);
});

test("an Undo is offered only after a clearing save", async () => {
  const html = await markup(
    <SaveStatus state={{ phase: "saved", undo: true }} onUndo={() => {}} />,
  );
  expect(html).toContain(t.saved);
  expect(html).toMatch(new RegExp(`<button[^>]*>${t.undo}</button>`));
});

test("a refusal shows the backend's words, or a plain line when it gave none", async () => {
  expect(
    await markup(
      <SaveStatus state={{ phase: "error", message: "Too long." }} />,
    ),
  ).toContain("Too long.");
  expect(
    await markup(<SaveStatus state={{ phase: "error", message: "" }} />),
  ).toContain(t.failed);
});
