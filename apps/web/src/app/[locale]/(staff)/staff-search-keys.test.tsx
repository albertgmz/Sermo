import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import type { Hit, SearchEntry } from "./search-match";

// The keyboard flow the search's own code decides. The web tests have no DOM, so Base UI's keys
// (arrows, Enter on the highlighted option, Escape) cannot run here; Base UI's combobox is
// replaced by a stand-in that records what the panel gives it: the options in the matcher's order,
// the first one highlighted for Enter, the list drawn in place so that Escape reaches the dialog,
// and what pressing an option does.

const nextIntl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));

type RootProps = {
  items: Hit[];
  autoHighlight?: boolean | "always";
  inline?: boolean;
  open?: boolean;
  filter?: unknown;
  children: ReactNode;
};
type ItemProps = { value: Hit; onClick: () => void; children: ReactNode };
let root: RootProps | undefined;
let options: ItemProps[] = [];
const real = { ...(await import("@base-ui/react/autocomplete")) };
mock.module("@base-ui/react/autocomplete", () => ({
  Autocomplete: {
    Root: (props: RootProps) => {
      root = props;
      options = [];
      return <>{props.children}</>;
    },
    Input: () => <input />,
    Status: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    List: ({ children }: { children: (item: Hit) => ReactNode }) => (
      <div>{root?.items.map((item) => children(item))}</div>
    ),
    Item: (props: ItemProps) => {
      options.push(props);
      return <div>{props.children}</div>;
    },
  },
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
  mock.module("@base-ui/react/autocomplete", () => real);
});

const { Dialog } = await import("@/components/ui/dialog");
const { afterPick, noteFor, SearchPanel } = await import(
  "./staff-search-popup"
);

const entry = (label: string, href: string, id = ""): SearchEntry => ({
  kind: "setting",
  label,
  help: "",
  id,
  path: ["Setup"],
  href,
});

const ENTRIES = [
  entry("Turnstile forms", "/admin/settings/antispam?setting=turnstileForms"),
  entry("Turnstile", "/admin/settings/antispam?setting=turnstileEnabled"),
  entry(
    "Site key",
    "/admin/settings/antispam?setting=turnstileSiteKey",
    "turnstileSiteKey",
  ),
];

function panel(query: string) {
  const opened: string[] = [];
  renderToStaticMarkup(
    withIntl(
      <Dialog open>
        <SearchPanel
          loaded={ENTRIES}
          query={query}
          onQuery={() => {}}
          onOpen={(href) => opened.push(href)}
        />
      </Dialog>,
    ),
  );
  return opened;
}

test("Enter opens the best match: the options come best first and the first is always highlighted", () => {
  panel("turnstile");
  expect(root?.autoHighlight).toBe("always");
  expect(options.map((option) => option.value.entry.label)).toEqual([
    "Turnstile",
    "Turnstile forms",
    "Site key",
  ]);
});

test("pressing an option, or Enter on it, opens that result's address", () => {
  const opened = panel("turnstile");
  options[0].onClick();
  options[2].onClick();
  expect(opened).toEqual([
    "/admin/settings/antispam?setting=turnstileEnabled",
    "/admin/settings/antispam?setting=turnstileSiteKey",
  ]);
});

test("the list is drawn in place and always open, so Escape is the dialog's and closes the search", () => {
  panel("site");
  expect(root?.inline).toBe(true);
  expect(root?.open).toBe(true);
  // The matcher has ranked them: Base UI must not filter again.
  expect(root?.filter).toBeNull();
});

test("the words under the box follow the index and the query", () => {
  expect(noteFor("failed", "turn", 0)).toEqual({ key: "failed" });
  expect(noteFor("loading", "", 0)).toEqual({ key: "hint" });
  expect(noteFor("loading", "turn", 0)).toEqual({ key: "loading" });
  expect(noteFor(ENTRIES, "  ", 0)).toEqual({ key: "hint" });
  expect(noteFor(ENTRIES, " zzz ", 0)).toEqual({ key: "empty", query: "zzz" });
  expect(noteFor(ENTRIES, "turn", 2)).toBeNull();
});

test("a result for the address already shown reveals its row there instead of opening it again", () => {
  const here = {
    pathname: "/admin/settings/antispam",
    search: "?setting=turnstileEnabled",
  };
  expect(
    afterPick("/admin/settings/antispam?setting=turnstileEnabled", here),
  ).toEqual({ navigate: false, reveal: "?setting=turnstileEnabled" });
  // Another row of the same screen, another screen, a screen with no row.
  expect(
    afterPick("/admin/settings/antispam?setting=turnstileSiteKey", here),
  ).toEqual({ navigate: true, reveal: null });
  expect(
    afterPick("/admin/permissions/forums?permission=forum.view", here),
  ).toEqual({ navigate: true, reveal: null });
  expect(
    afterPick("/admin/settings/antispam", { ...here, search: "" }),
  ).toEqual({ navigate: false, reveal: null });
});
