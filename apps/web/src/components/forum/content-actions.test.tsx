import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/threads/3",
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
const { ContentActions } = await import("./content-actions");
const { ShareButton, ShareMenuBody, copyLink, shareNatively } = await import(
  "./share-button"
);

const action = async () => ({});
const load = async () => null;

function draw(props: Parameters<typeof ContentActions>[0]) {
  menus = [];
  return renderToStaticMarkup(withIntl(<ContentActions {...props} />));
}

const full = {
  summary: <i data-mark="summary" />,
  react: <i data-mark="react" />,
  quote: { postId: 1, event: "quote", load },
  reply: { href: "#reply" },
  share: "/threads/3#post-1",
  edit: { href: "/threads/3/edit/1" },
  remove: { action },
  report: { action },
  moderation: <i data-mark="moderation" />,
} satisfies Parameters<typeof ContentActions>[0];

test("a bar draws only the controls it is given", () => {
  const html = draw({ share: "/x" });
  expect(html).toContain('aria-label="Share"');
  for (const label of ["Quote", "Reply", "Edit", "Delete", "Report"]) {
    expect(html).not.toContain(`aria-label="${label}"`);
  }
});

test("react, quote and reply sit on the left, the rest on the right, the summary above", () => {
  const html = draw(full);
  const at = (text: string) => html.indexOf(text);
  expect(at('data-mark="summary"')).toBeLessThan(at('data-mark="react"'));
  expect(at('data-mark="react"')).toBeLessThan(at('aria-label="Quote"'));
  expect(at('aria-label="Quote"')).toBeLessThan(at('aria-label="Reply"'));
  expect(at('aria-label="Reply"')).toBeLessThan(at('aria-label="Share"'));
  expect(at('aria-label="Share"')).toBeLessThan(at('aria-label="Edit"'));
  expect(at('aria-label="Edit"')).toBeLessThan(at('aria-label="Delete"'));
  expect(at('aria-label="Delete"')).toBeLessThan(at('aria-label="Report"'));
  expect(at('aria-label="Report"')).toBeLessThan(at('data-mark="moderation"'));
});

test("a soft rule parts the footer from the body", () => {
  expect(draw({ share: "/x" })).toContain("border-t border-dashed");
});

test("the split bar of a post: report, edit, delete and moderation on the left, react, + Quote and reply on the right, the summary under it", () => {
  const html = draw({ ...full, share: undefined, layout: "split" });
  const at = (text: string) => html.indexOf(text);
  expect(at('aria-label="Report"')).toBeLessThan(at('aria-label="Edit"'));
  expect(at('aria-label="Edit"')).toBeLessThan(at('aria-label="Delete"'));
  expect(at('aria-label="Delete"')).toBeLessThan(at('data-mark="moderation"'));
  expect(at('data-mark="moderation"')).toBeLessThan(at('data-mark="react"'));
  expect(at('data-mark="react"')).toBeLessThan(at('aria-label="Quote"'));
  expect(at('aria-label="Quote"')).toBeLessThan(at('aria-label="Reply"'));
  expect(at('aria-label="Reply"')).toBeLessThan(at('data-mark="summary"'));
  expect(html).toContain('<span class="hidden sm:inline">+ Quote</span>');
  // The post's header row carries the rule.
  expect(html).not.toContain("border-t");
});

test("an ordinary member's split bar shows the words on a phone too; with edit, delete or moderation it keeps to icons there", () => {
  const member = draw({
    react: <i data-mark="react" />,
    quote: { postId: 1, event: "quote", load },
    reply: { href: "#reply" },
    report: { action },
    layout: "split",
  });
  expect(member).toContain('<span class="inline">+ Quote</span>');
  expect(member).toContain('<span class="inline">Reply</span>');
  expect(member).toContain('<span class="inline">Report</span>');
  for (const extra of [
    { edit: { href: "/threads/3/edit/1" } },
    { remove: { action } },
    { moderation: <i data-mark="moderation" /> },
  ]) {
    const staff = draw({
      quote: { postId: 1, event: "quote", load },
      reply: { href: "#reply" },
      report: { action },
      layout: "split",
      ...extra,
    });
    expect(staff).toContain('<span class="hidden sm:inline">+ Quote</span>');
    expect(staff).not.toContain('<span class="inline">');
  }
});

test("the split bar leaves share and bookmark to the post's header row", () => {
  const html = draw({
    share: "/x",
    bookmark: { contentType: "post", contentId: 1, bookmarked: false },
    report: { action },
    layout: "split",
  });
  expect(html).not.toContain('aria-label="Share"');
  expect(html).not.toContain("Bookmark");
});

test("the wall bar: the date, report, the menu and moderation on the left, react and the rest on the right, the summary under it", () => {
  const html = draw({
    ...full,
    quote: undefined,
    reply: undefined,
    start: <i data-mark="start" />,
    leading: <i data-mark="date" />,
    layout: "wall",
  });
  const at = (text: string) => html.indexOf(text);
  expect(at('data-mark="date"')).toBeLessThan(at('aria-label="Report"'));
  expect(at('aria-label="Report"')).toBeLessThan(
    at('aria-label="More options"'),
  );
  expect(at('aria-label="More options"')).toBeLessThan(
    at('data-mark="moderation"'),
  );
  expect(at('data-mark="moderation"')).toBeLessThan(at('data-mark="react"'));
  expect(at('data-mark="react"')).toBeLessThan(at('data-mark="start"'));
  expect(at('data-mark="start"')).toBeLessThan(at('data-mark="summary"'));
  // Report keeps its word on a phone, as XenForo's "Denunciar"; no rule above the bar.
  expect(html).toContain('<span class="inline">Report</span>');
  expect(html).not.toContain("border-t");
});

test("the wall bar folds edit and delete into its menu and keeps share as an icon beside report", () => {
  const html = draw({ ...full, layout: "wall" });
  for (const label of ["Edit", "Delete"]) {
    expect(html).not.toContain(`aria-label="${label}"`);
  }
  const at = (text: string) => html.indexOf(text);
  expect(at('aria-label="Report"')).toBeLessThan(at('aria-label="Share"'));
  expect(at('aria-label="Share"')).toBeLessThan(
    at('aria-label="More options"'),
  );
  // An icon: no word beside it.
  expect(html).not.toContain(">Share</span>");
  expect(menus).toHaveLength(1);
  expect(menus[0]?.edit).toBe("/threads/3/edit/1");
  expect(typeof menus[0]?.onDelete).toBe("function");
  // An edit panel is opened from the menu.
  draw({ edit: { panel: <i data-mark="form" /> }, layout: "wall" });
  expect(typeof menus[0]?.edit).toBe("function");
});

test("the wall bar has no menu when it would hold nothing: a member who may only report and share sees both at once", () => {
  const html = draw({ report: { action }, share: "/x", layout: "wall" });
  expect(html).not.toContain("More options");
  expect(html).toContain('aria-label="Report"');
  expect(html).toContain('aria-label="Share"');
});

test("the default bar keeps the plain Quote word", () => {
  expect(draw(full)).toContain('<span class="hidden sm:inline">Quote</span>');
});

test("on a phone the buttons are icons with the label as their name", () => {
  const html = draw(full);
  // The word is drawn from sm up only.
  expect(html).toContain('<span class="hidden sm:inline">Report</span>');
  expect(html).toContain('<span class="hidden sm:inline">Share</span>');
  expect(html).toContain("h-10 min-w-10");
});

test("edit is a link to the edit page, or a button that opens a panel", () => {
  expect(draw({ edit: { href: "/threads/3/edit/1" } })).toContain(
    'href="/threads/3/edit/1"',
  );
  const html = draw({ edit: { panel: <i data-mark="form" /> } });
  expect(html).toContain('aria-expanded="false"');
  // Closed, the panel is not in the page.
  expect(html).not.toContain('data-mark="form"');
});

test("delete and report keep their forms closed until pressed", () => {
  const html = draw({ remove: { action }, report: { action } });
  expect(html).not.toContain("<form");
  expect(html).not.toContain("Why are you reporting this?");
});

test("without the share sheet the link is copied from a small menu", () => {
  const html = renderToStaticMarkup(
    withIntl(<ShareButton href="/threads/3#post-1" label="Share" />),
  );
  expect(html).toContain('aria-label="Share"');
  // The menu opens on press, not before.
  expect(html).not.toContain("Copy link");
});

test("the share sheet is used where the device has one, and the menu where it has none", async () => {
  const shared: { url: string }[] = [];
  let fallbacks = 0;
  const fallback = () => {
    fallbacks += 1;
  };
  expect(
    shareNatively(
      "https://forum.test/a",
      {
        share: async (data) => {
          shared.push(data);
        },
      },
      fallback,
    ),
  ).toBe(true);
  expect(shared).toEqual([{ url: "https://forum.test/a" }]);
  expect(shareNatively("https://forum.test/a", {}, fallback)).toBe(false);
  expect(fallbacks).toBe(0);
});

test("closing the share sheet is quiet; any other failure opens the copy menu", async () => {
  let fallbacks = 0;
  const fallback = () => {
    fallbacks += 1;
  };
  const failing = (error: unknown) => ({ share: () => Promise.reject(error) });
  expect(
    shareNatively(
      "u",
      failing(new DOMException("closed", "AbortError")),
      fallback,
    ),
  ).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(fallbacks).toBe(0);
  shareNatively(
    "u",
    failing(new DOMException("no", "NotAllowedError")),
    fallback,
  );
  await Promise.resolve();
  await Promise.resolve();
  expect(fallbacks).toBe(1);
  // A throw before any sheet opens: the caller opens the menu itself.
  expect(
    shareNatively(
      "u",
      {
        share: () => {
          throw new TypeError("bad");
        },
      },
      fallback,
    ),
  ).toBe(false);
});

test("copying reports whether the clipboard took the link", async () => {
  const written: string[] = [];
  expect(
    await copyLink("u", {
      clipboard: {
        writeText: async (text) => {
          written.push(text);
        },
      },
    }),
  ).toBe(true);
  expect(written).toEqual(["u"]);
  expect(await copyLink("u", {})).toBe(false);
  expect(
    await copyLink("u", {
      clipboard: { writeText: () => Promise.reject(new Error("no")) },
    }),
  ).toBe(false);
});

test("where copying failed the menu shows the link in a read-only field to copy by hand", () => {
  const draw = (status: "idle" | "copied" | "manual") =>
    renderToStaticMarkup(
      withIntl(
        <ShareMenuBody
          url="https://forum.test/a"
          status={status}
          onCopy={() => {}}
        />,
      ),
    );
  const manual = draw("manual");
  expect(manual).toContain("readOnly");
  expect(manual).toContain('value="https://forum.test/a"');
  expect(manual).toContain("Copy this link");
  expect(draw("idle")).not.toContain("<input");
  expect(draw("copied")).toContain("Link copied");
});
