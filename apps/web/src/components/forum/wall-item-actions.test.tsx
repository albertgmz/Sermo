import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/members/9",
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

const { WallItemActions } = await import("./wall-item-actions");

type Props = Parameters<typeof WallItemActions>[0];

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: 12,
    author: { id: 3 },
    state: "visible",
    editedAt: null,
    canEdit: false,
    canDelete: false,
    canReport: true,
    reactions: { counts: {}, total: 0, mine: null },
    ...over,
  }) as Props["item"];

function draw(
  kind: "post" | "comment",
  over: Record<string, unknown>,
  viewerId: number | null,
) {
  return renderToStaticMarkup(
    withIntl(
      <WallItemActions
        kind={kind}
        item={item(over)}
        address={{ profileUserId: 9, postId: 12 }}
        viewerId={viewerId}
        picker={[]}
        reactionTypes={[]}
      />,
    ),
  );
}

const has = (html: string, label: string) =>
  html.includes(`aria-label="${label}"`);

for (const kind of ["post", "comment"] as const) {
  test(`the author of a wall ${kind} edits it in place and deletes it, and cannot report it`, () => {
    const html = draw(kind, { canEdit: true, canDelete: true }, 3);
    expect(has(html, "Edit")).toBe(true);
    expect(html).toContain('aria-expanded="false"');
    expect(has(html, "Delete")).toBe(true);
    expect(has(html, "Report")).toBe(false);
  });

  test(`the wall's owner deletes someone else's ${kind} without editing it`, () => {
    const html = draw(kind, { canDelete: true }, 9);
    expect(has(html, "Delete")).toBe(true);
    expect(has(html, "Edit")).toBe(false);
    expect(has(html, "Report")).toBe(true);
  });

  test(`report on a wall ${kind} follows the backend's word, not the viewer being signed in`, () => {
    expect(has(draw(kind, {}, 9), "Report")).toBe(true);
    expect(has(draw(kind, { canReport: false }, 9), "Report")).toBe(false);
  });

  test(`a guest gets only share on a wall ${kind}`, () => {
    const html = draw(kind, {}, null);
    expect(has(html, "Share")).toBe(true);
    for (const label of ["Edit", "Delete", "Report"]) {
      expect(has(html, label)).toBe(false);
    }
  });

  test(`a deleted wall ${kind} offers no controls to a moderator who cannot restore here`, () => {
    const html = draw(
      kind,
      { state: "deleted", canEdit: true, canDelete: true },
      5,
    );
    for (const label of ["Share", "Edit", "Delete", "Report"]) {
      expect(has(html, label)).toBe(false);
    }
  });
}
