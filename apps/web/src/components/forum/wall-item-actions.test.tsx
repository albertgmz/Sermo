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
// The stand-in records what the "•••" menu would open with; the bar draws only its plain button.
let menus: Record<string, unknown>[] = [];
const realPopup = { ...(await import("@/components/ui/lazy-popup")) };
mock.module("@/components/ui/lazy-popup", () => ({
  ...realPopup,
  LazyPopup: (props: {
    popup: Record<string, unknown>;
    trigger: (lazy: object) => React.ReactElement;
  }) => {
    if ("onDelete" in props.popup) menus.push(props.popup);
    return props.trigger({});
  },
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
  mock.module("@/components/ui/lazy-popup", () => realPopup);
});

const { WallItemActions } = await import("./wall-item-actions");

type Props = Parameters<typeof WallItemActions>[0];

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: 12,
    author: { id: 3 },
    state: "visible",
    createdAt: "2026-01-02T00:00:00.000Z",
    editedAt: null,
    canEdit: false,
    canDelete: false,
    canReport: true,
    reactions: { counts: {}, total: 0, mine: null },
    ...over,
  }) as Props["item"];

// The bar's markup, with what its "•••" menu holds written as the labels of its items.
function draw(
  kind: "post" | "comment",
  over: Record<string, unknown>,
  viewerId: number | null,
  props: Partial<Props> = {},
) {
  menus = [];
  const html = renderToStaticMarkup(
    withIntl(
      <WallItemActions
        kind={kind}
        item={item(over)}
        address={{ profileUserId: 9, postId: 12 }}
        viewerId={viewerId}
        picker={[]}
        reactionTypes={[]}
        {...props}
      />,
    ),
  );
  const menu = menus[0];
  const held = menu
    ? [
        menu.share && "Share",
        menu.edit && "Edit",
        menu.onDelete && "Delete",
      ].filter(Boolean)
    : [];
  return `${html}${held.map((label) => ` aria-label="${label}"`).join("")}`;
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

test("a comment's footer: its date, report and the menu on the left, react on the right", () => {
  const html = draw("comment", { canDelete: true }, 9, {
    picker: [{ id: 1, key: "like", label: "Like", emoji: "👍", picture: null }],
  });
  const at = (text: string) => html.indexOf(text);
  expect(at("<time")).toBeGreaterThan(-1);
  expect(at("<time")).toBeLessThan(at('aria-label="Report"'));
  expect(at('aria-label="Report"')).toBeLessThan(
    at('aria-label="More options"'),
  );
  expect(at('aria-label="More options"')).toBeLessThan(at("ml-auto"));
  expect(at("ml-auto")).toBeLessThan(at("lucide-heart"));
  // The word, also on a phone, as XenForo's "Denunciar".
  expect(html).toContain('<span class="inline">Report</span>');
  // No rule above the bar.
  expect(html).not.toContain("border-dashed");
});

test("a wall post's date stays in its header: its footer starts with report", () => {
  const html = draw("post", {}, 5);
  expect(html).not.toContain("<time");
  expect(html.indexOf('aria-label="Report"')).toBeLessThan(
    html.indexOf('aria-label="More options"'),
  );
});

test("the share link of the menu names the item: the post, or the comment on it", () => {
  draw("post", {}, null);
  expect(menus[0]?.share).toBe("/members/9?post=12#profile-post-12");
  draw("comment", {}, null);
  expect(menus[0]?.share).toContain("comment=12");
});
