import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { postBody } from "@/lib/test-bodies";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/threads/7",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {} }),
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
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { PostActions } = await import("./post-actions");

type Props = Parameters<typeof PostActions>[0];
const may = {
  stick: false,
  feature: false,
  lock: false,
  move: false,
  merge: false,
  split: false,
  delete: false,
  hardDelete: false,
  hardDeleteAny: false,
  attach: false,
  restoreDeleted: false,
  restoreWaiting: false,
  any: false,
} satisfies Props["may"];

function draw(over: Record<string, unknown>, props: Partial<Props> = {}) {
  return renderToStaticMarkup(
    withIntl(
      <PostActions
        post={postBody(over) as Props["post"]}
        viewerId={9}
        picker={[]}
        reactionTypes={[]}
        may={may}
        noteState={false}
        canQuote
        {...props}
      />,
    ),
  );
}

const has = (html: string, label: string) =>
  html.includes(`aria-label="${label}"`);

test("the author of a post can edit and delete it, and cannot report it", () => {
  const html = draw({ canEdit: true, canDelete: true, canReport: false });
  expect(has(html, "Edit")).toBe(true);
  expect(has(html, "Delete")).toBe(true);
  expect(has(html, "Report")).toBe(false);
  expect(html).toContain('href="/threads/7/edit/31"');
});

test("another member can report a post, and does not get edit or delete", () => {
  const html = draw({ canEdit: false, canDelete: false, canReport: true });
  expect(has(html, "Report")).toBe(true);
  expect(has(html, "Edit")).toBe(false);
  expect(has(html, "Delete")).toBe(false);
});

test("an administrator who may edit, delete and report gets all three", () => {
  const html = draw({ canEdit: true, canDelete: true, canReport: true });
  for (const label of ["Edit", "Delete", "Report", "Quote"]) {
    expect(has(html, label)).toBe(true);
  }
  expect(has(html, "Reply")).toBe(false);
});

test("as on XenForo, report, edit and delete sit on the left and react and + Quote on the right", () => {
  const html = draw({ canEdit: true, canDelete: true, canReport: true });
  const at = (label: string) => html.indexOf(`aria-label="${label}"`);
  expect(at("Report")).toBeLessThan(at("Edit"));
  expect(at("Edit")).toBeLessThan(at("Delete"));
  expect(at("Delete")).toBeLessThan(at("Quote"));
  expect(html).toContain('<span class="inline">+ Quote</span>');
});

test("share and bookmark are not in the footer: the post's header row has them", () => {
  const html = draw({ canEdit: true, canDelete: true, canReport: true });
  expect(has(html, "Share")).toBe(false);
  expect(html).not.toContain("Bookmark");
});

test("a guest gets no reply, quote, edit, delete or report", () => {
  const html = draw(
    { canEdit: false, canDelete: false, canReport: false },
    { viewerId: null, canQuote: false },
  );
  for (const label of ["Reply", "Quote", "Edit", "Delete", "Report"]) {
    expect(has(html, label)).toBe(false);
  }
});

test("a deleted post offers no delete or report, and no quote", () => {
  const html = draw({
    state: "deleted",
    canEdit: false,
    canDelete: true,
    canReport: true,
  });
  for (const label of ["Quote", "Delete", "Report"]) {
    expect(has(html, label)).toBe(false);
  }
});

test("a moderator sees approve on a post waiting for approval, inside the bar", () => {
  const html = draw(
    { state: "moderated", canEdit: false, canDelete: false, canReport: false },
    { may: { ...may, restoreWaiting: true }, noteState: true },
  );
  expect(html).toContain("Approve");
  expect(draw({ state: "moderated" }, { noteState: true })).not.toContain(
    "Approve",
  );
});

test("deleting a reply for good follows the backend's flag: a deleted one for staff, a live one for its author", () => {
  const deleted = {
    state: "deleted",
    canEdit: false,
    canDelete: false,
    canReport: false,
  };
  expect(
    draw({ ...deleted, canHardDelete: true }, { noteState: true }),
  ).toContain("Delete permanently");
  expect(
    draw({ ...deleted, canHardDelete: false }, { noteState: true }),
  ).not.toContain("Delete permanently");
  // The author's own live reply carries no note. With the right to hide it too, deleting for good
  // is a choice inside the delete dialog; without, it is the only delete.
  const live = { canDelete: false };
  expect(draw({ ...live, canHardDelete: true })).toContain(
    "Delete permanently",
  );
  expect(draw({ ...live, canHardDelete: false })).not.toContain(
    "Delete permanently",
  );
  expect(draw({ canDelete: true, canHardDelete: true })).not.toContain(
    "Delete permanently",
  );
});

test("as on XenForo, nobody is offered to report their own post, even where the backend would take it", () => {
  // The fixture's post is by member 3.
  const own = draw({ canReport: true }, { viewerId: 3 });
  expect(has(own, "Report")).toBe(false);
  expect(has(draw({ canReport: true }, { viewerId: 9 }), "Report")).toBe(true);
});

test("no post offers a reply, deleted or not", () => {
  const html = draw(
    { state: "deleted", canDelete: true, canReport: true },
    { noteState: true, part: "footer" },
  );
  expect(has(html, "Reply")).toBe(false);
  expect(has(draw({}), "Reply")).toBe(false);
  expect(draw({})).not.toContain("Responder");
});
