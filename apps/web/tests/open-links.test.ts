import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A link to a whole thread or conversation is built by `lib/sermo/open-links`, so that a member
// lands where they left off. A file that writes the address itself (a template string such as
// `/threads/${id}`) is listed here with why that is right; any other file doing it fails, and so
// does a list added later that forgets the helper.
const OWN_ADDRESS = /[`"']\/(threads|conversations)\/(\$\{|"\s*\+)/;

const ALLOWED: Record<string, string> = {
  "src/lib/sermo/open-links.ts": "the helper",
  // Redirects, revalidated paths and the upload address of a form; none is a link in a list.
  "src/app/[locale]/(main)/conversations/actions.ts":
    "redirects and revalidation",
  "src/app/[locale]/(main)/conversations/send-message.ts": "revalidation",
  "src/app/[locale]/(main)/forums/actions.ts":
    "redirect after creating a thread",
  "src/app/[locale]/(main)/threads/actions.ts": "redirects and revalidation",
  "src/app/[locale]/(main)/threads/polls-actions.ts": "revalidation",
  "src/app/[locale]/(main)/threads/send-reply.ts": "revalidation",
  "src/components/forum/attachment-field.tsx": "upload address",
  "src/components/forum/poll-form.tsx": "upload address",
  "src/components/forum/poll-block.tsx": "sign-in return address",
  "src/components/forum/quiz-player.tsx": "sign-in return address",
  // A conversation's and a thread's own pages: their pager, edit, select and sign-in links.
  "src/app/[locale]/(main)/conversations/[id]/message-target.ts":
    "a message's address",
  "src/app/[locale]/(main)/conversations/[id]/page.tsx":
    "the conversation's own pager",
  "src/app/[locale]/(main)/threads/[id]/edit/[postId]/page.tsx":
    "sign-in return address",
  "src/app/[locale]/(main)/threads/[id]/moderation.tsx":
    "the thread's own selection links",
  "src/app/[locale]/(main)/threads/[id]/pages.ts": "a post's address",
  "src/app/[locale]/(main)/threads/[id]/page.tsx": "the thread's own addresses",
  "src/app/[locale]/(main)/threads/[id]/post-actions.tsx": "edit link",
  // Who is online: the page another member is viewing, linked as XenForo's user_activity links it.
  "src/components/forum/activity-line.tsx": "the page a visitor is viewing",
  // Alerts name the exact item they are about.
  "src/app/[locale]/(main)/notifications/href.ts": "alerts point at the item",
  // Staff panels link the content a moderator is looking at.
  "src/app/[locale]/(staff)/admin/broadcasts/broadcast-form.tsx": "staff panel",
  "src/app/[locale]/(staff)/admin/logs/moderator/moderator-log.tsx":
    "staff panel",
  "src/app/[locale]/(staff)/moderation/content.ts": "staff panel",
  "src/app/[locale]/(staff)/moderation/where.tsx": "staff panel",
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : [];
  });
}

test("no file outside the allowed ones writes a thread or conversation address to link to", () => {
  const writing = sources("src").filter((file) =>
    OWN_ADDRESS.test(readFileSync(file, "utf8")),
  );
  expect(writing.filter((file) => !(file in ALLOWED))).toEqual([]);
});

test("every allowed file still writes such an address, so the list holds no stale entry", () => {
  const writing = new Set(
    sources("src").filter((file) =>
      OWN_ADDRESS.test(readFileSync(file, "utf8")),
    ),
  );
  expect(Object.keys(ALLOWED).filter((file) => !writing.has(file))).toEqual([]);
});

test("the shared thread link has no default address, so a list cannot leave it out", () => {
  const source = readFileSync(
    "src/components/forum/thread-hover-card.tsx",
    "utf8",
  );
  expect(source).not.toMatch(/href\s*=\s*`/);
});
