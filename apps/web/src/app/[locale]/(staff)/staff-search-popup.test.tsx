import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import type { SearchEntry } from "./search-match";

const nextIntl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
});

const { Dialog } = await import("@/components/ui/dialog");
const { SearchPanel } = await import("./staff-search-popup");
const { INPUT_ID } = await import("./staff-search");

const ENTRIES: SearchEntry[] = [
  {
    kind: "screen",
    label: "Anti-spam",
    help: "",
    id: "",
    path: ["Setup"],
    href: "/admin/settings/antispam",
  },
  {
    kind: "setting",
    label: "Turnstile",
    help: "Ask guests to solve a check.",
    id: "turnstileEnabled",
    path: ["Setup", "Anti-spam"],
    href: "/admin/settings/antispam?setting=turnstileEnabled",
  },
  {
    kind: "permission",
    label: "Post as a guest",
    help: "",
    id: "forum.guestPost",
    path: ["Groups and permissions", "Forum permissions"],
    href: "/admin/permissions/forums?permission=forum.guestPost",
  },
];

const render = (
  query: string,
  loaded: SearchEntry[] | "loading" | "failed" = ENTRIES,
) =>
  renderToStaticMarkup(
    withIntl(
      // The panel's close button belongs to the dialog it is drawn in.
      <Dialog open>
        <SearchPanel
          loaded={loaded}
          query={query}
          onQuery={() => {}}
          onOpen={() => {}}
        />
      </Dialog>,
    ),
  );

const tags = (html: string, attribute: string) =>
  (html.match(/<[a-z]+ [^>]*>/g) ?? []).filter((tag) =>
    tag.includes(attribute),
  );

test("the box is a combobox with a list that holds the results as options", () => {
  const html = render("turnstile");
  const [input] = tags(html, `id="${INPUT_ID}"`);
  expect(input).toContain('role="combobox"');
  expect(input).toContain('aria-label="Search the panel"');
  expect(input).toContain('value="turnstile"');
  // Base UI's combobox (it ties the box to the list once it runs in the browser).
  expect(input).toContain('aria-autocomplete="list"');
  expect(input).toContain('aria-haspopup="listbox"');
  expect(tags(html, 'role="listbox"')).toHaveLength(1);
  const options = tags(html, 'role="option"');
  expect(options).toHaveLength(1);
  expect(html).toContain("Turnstile");
  expect(html).toContain("Setup › Anti-spam");
  expect(html).toContain("Setting");
});

test("a result found by its id shows the id under it", () => {
  const html = render("guestPost");
  expect(tags(html, 'role="option"')).toHaveLength(1);
  expect(html).toContain("Groups and permissions › Forum permissions");
  expect(html).toContain('<span class="font-mono">forum.guestPost</span>');
  expect(html).toContain("Permission");
  // Found by its label, the id stays out of the way.
  expect(render("post as")).not.toContain("font-mono");
});

test("before a query the box says what it finds; a query that matches nothing says so", () => {
  expect(render("")).toContain(
    "Type a name, a word of its help or an id such as forum.guestPost.",
  );
  expect(tags(render(""), 'role="option"')).toHaveLength(0);
  expect(render("zzz")).toContain("Nothing matches “zzz”.");
});

test("while the index loads, and when it could not be read, the box says so", () => {
  expect(render("turn", "loading")).toContain("Loading the search…");
  expect(render("turn", "failed")).toContain(
    "The search could not be loaded. Close it and try again.",
  );
});

test("the keys are named under the list for a keyboard, and the count is read out", () => {
  const html = render("a");
  expect(html).toContain("move");
  expect(html).toContain("open");
  expect(html).toMatch(/aria-live="polite"[^>]*>[^<]*\d+ results?/);
});
