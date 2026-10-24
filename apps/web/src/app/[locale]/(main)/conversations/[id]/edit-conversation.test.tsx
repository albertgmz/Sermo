import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog } from "@/components/ui/dialog";
import { withIntl } from "@/lib/test-intl";

mock.module("@/app/[locale]/(main)/conversations/actions", () => ({
  editConversationAction: async () => ({}),
}));

const { EditConversationButton } = await import("./edit-conversation-button");
const { ConversationEditor } = await import("./edit-conversation-popup");

const conversation = {
  id: 7,
  title: "Plans for the weekend",
  isLocked: false,
  canRename: true,
  canLock: true,
};

const button = (overrides: Partial<typeof conversation> = {}) =>
  renderToStaticMarkup(
    withIntl(
      <EditConversationButton
        conversation={{ ...conversation, ...overrides }}
      />,
    ),
  );

// The dialog's form, inside the dialog it closes.
const editor = (title: string | null, locked: boolean | null) =>
  renderToStaticMarkup(
    withIntl(
      <Dialog open>
        <ConversationEditor
          conversationId={7}
          title={title}
          locked={locked}
          onDone={() => {}}
        />
      </Dialog>,
    ),
  );

test("the header offers Edit to a viewer who may rename or lock, and to no one else", () => {
  expect(button()).toContain(">Edit<");
  expect(button()).toContain('aria-haspopup="dialog"');
  expect(button({ canRename: false })).toContain(">Edit<");
  expect(button({ canLock: false })).toContain(">Edit<");
  expect(button({ canRename: false, canLock: false })).toBe("");
});

test("the dialog opens with the title and the lock as they are, XenForo's fields and Save", () => {
  const open = editor("Plans for the weekend", false);
  expect(open).toContain(">Title<");
  expect(open).toContain('value="Plans for the weekend"');
  expect(open).toContain("Lock direct message");
  expect(open).toContain("No replies are allowed");
  expect(open).toMatch(/<input[^>]*type="checkbox"[^>]*name="locked"/);
  expect(open).not.toMatch(/<input[^>]*name="locked"[^>]*checked/);
  expect(open).toContain(">Save<");
  expect(open).toContain(">Cancel<");
  const locked = editor("Plans for the weekend", true);
  expect(locked).toMatch(/<input[^>]*name="locked"[^>]*checked/);
  expect(locked).toContain('name="lockedWas" value="1"');
});

test("the dialog holds only what the viewer may change", () => {
  const lockOnly = editor(null, true);
  expect(lockOnly).not.toContain('name="title"');
  expect(lockOnly).not.toContain('name="titleWas"');
  expect(lockOnly).toContain("Lock direct message");
  const titleOnly = editor("Plans for the weekend", null);
  expect(titleOnly).toContain('name="title"');
  expect(titleOnly).not.toContain('name="locked"');
  expect(titleOnly).not.toContain('name="lockedWas"');
});

test("the dialog's code is loaded when the button is reached for, and its form fits a phone", () => {
  const source = (name: string) =>
    readFileSync(join(import.meta.dir, name), "utf8");
  expect(source("edit-conversation-button.tsx")).toContain(
    'import("@/app/[locale]/(main)/conversations/[id]/edit-conversation-popup")',
  );
  expect(source("edit-conversation-button.tsx")).not.toMatch(
    /^import (?!type )[^;]*edit-conversation-popup/m,
  );
  expect(source("edit-conversation-popup.tsx")).toMatch(
    /<form[^>]*className="grid min-w-0 gap-4"/,
  );
});
