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
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { ContentActions } = await import("./content-actions");
const { ShareButton, shareNatively } = await import("./share-button");

const action = async () => ({});
const load = async () => null;

function draw(props: Parameters<typeof ContentActions>[0]) {
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
  expect(
    shareNatively("https://forum.test/a", {
      share: async (data) => {
        shared.push(data);
      },
    }),
  ).toBe(true);
  expect(shared).toEqual([{ url: "https://forum.test/a" }]);
  expect(shareNatively("https://forum.test/a", {})).toBe(false);
  // A closed sheet rejects: nothing is raised.
  expect(
    shareNatively("https://forum.test/a", {
      share: () => Promise.reject(new DOMException("closed", "AbortError")),
    }),
  ).toBe(true);
  await Promise.resolve();
});
