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
        bookmarked={null}
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
  for (const label of ["Edit", "Delete", "Report", "Share", "Quote", "Reply"]) {
    expect(has(html, label)).toBe(true);
  }
});

test("a signed-in viewer gets the bookmark toggle beside share, with the state in its label", () => {
  const off = draw({}, { bookmarked: false });
  expect(has(off, "Bookmark")).toBe(true);
  expect(off.indexOf("Bookmark")).toBeLessThan(off.indexOf("Share"));
  expect(off).not.toContain('aria-pressed="');
  const on = draw({}, { bookmarked: true });
  expect(has(on, "Remove bookmark")).toBe(true);
  expect(has(on, "Bookmark")).toBe(false);
});

test("no bookmark toggle for a guest or when the state is unknown", () => {
  expect(has(draw({}, { bookmarked: null }), "Bookmark")).toBe(false);
});

test("a guest gets share and reply, and no quote, edit, delete or report", () => {
  const html = draw(
    { canEdit: false, canDelete: false, canReport: false },
    { viewerId: null, canQuote: false },
  );
  expect(has(html, "Share")).toBe(true);
  expect(has(html, "Reply")).toBe(true);
  for (const label of ["Quote", "Edit", "Delete", "Report"]) {
    expect(has(html, label)).toBe(false);
  }
});

test("a deleted post offers no share, delete or report, and no quote", () => {
  const html = draw({
    state: "deleted",
    canEdit: false,
    canDelete: true,
    canReport: true,
  });
  for (const label of ["Share", "Quote", "Delete", "Report"]) {
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
