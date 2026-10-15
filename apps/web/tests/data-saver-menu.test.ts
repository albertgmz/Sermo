import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { read, walk } from "./lite-scan";
import { LOCALE_DIRS, MESSAGES } from "./locales";

// A menu opens in a portal the server never renders, and there is no DOM here: the menus are
// pinned by what their source holds.
const ENTRY = /<DataSaverMenuItem\b/g;
const LINK = /<DataSaverLink\b/g;

test("a member's menu and a guest's menu each hold one Data saver entry, to the page of their own", () => {
  const member = read("src/components/layout/user-menu-body.tsx");
  expect(member.match(LINK)).toHaveLength(1);
  expect(member).toContain("href={DATA_SAVER_HREF}");
  expect(read("src/app/[locale]/(main)/account/links.ts")).toContain(
    'DATA_SAVER_HREF = "/account/data-saver"',
  );
  const guest = read("src/components/layout/guest-menu.tsx");
  expect(guest.match(ENTRY)).toHaveLength(1);
  expect(guest).toContain('href="/data-saver"');
});

test("the header gives a guest the menu, and a member's own menu comes with the account", () => {
  expect(read("src/components/layout/site-header.tsx")).toContain("<GuestMenu");
  expect(read("src/components/layout/account-menu.tsx")).toContain("<UserMenu");
});

test("the menu has no quick switch: the entry only links, and no layout file writes the preference", () => {
  const item = read("src/components/layout/data-saver-menu-item.tsx");
  expect(item).toContain("<Link href={href} />");
  const writers = walk("src/components/layout").filter((path) =>
    /\bsetLiteMode\b/.test(read(path)),
  );
  expect(writers).toEqual([]);
});

test("the menu entry is labelled and its state is on, off or custom", () => {
  for (const locale of LOCALE_DIRS) {
    const lite = JSON.parse(
      readFileSync(join(MESSAGES, locale, "lite.json"), "utf8"),
    );
    expect(lite.menuItem.label).toBe(lite.navigation.label);
    expect(Object.keys(lite.status).sort()).toEqual(["off", "on", "partial"]);
    expect(lite.status.partial).not.toContain("{");
  }
});

// What a visitor reads is the Data saver everywhere; only keys and file names keep the old word.
test("no message calls the Data saver LITE", () => {
  const offenders: string[] = [];
  const visit = (value: unknown, where: string) => {
    if (typeof value === "string") {
      if (/\blite\b/i.test(value)) offenders.push(`${where}: ${value}`);
    } else if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value))
        visit(inner, `${where}.${key}`);
    }
  };
  for (const locale of LOCALE_DIRS) {
    for (const file of readdirSync(join(MESSAGES, locale))) {
      visit(
        JSON.parse(readFileSync(join(MESSAGES, locale, file), "utf8")),
        `${locale}/${file}`,
      );
    }
  }
  expect(offenders).toEqual([]);
});
