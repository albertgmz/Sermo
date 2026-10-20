import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNT_GROUPS,
  accountLinks,
  DATA_SAVER_HREF,
  menuAccountLinks,
} from "./links";

const hrefs = (links: { href: string }[]) => links.map((link) => link.href);

test("the menu lists the account screens of the account page, in the same order", () => {
  const menu = hrefs(menuAccountLinks([]));
  const page = hrefs(accountLinks());
  expect(menu).toEqual(page.filter((href) => href !== "/account/bookmarks"));
  expect(menu).toContain(DATA_SAVER_HREF);
});

test("the menu leaves out what it reaches another way", () => {
  const menu = hrefs(
    menuAccountLinks(["/account", "/account/privacy", "/members/4"]),
  );
  expect(menu).not.toContain("/account");
  expect(menu).not.toContain("/account/bookmarks");
  expect(menu).not.toContain("/account/privacy");
  expect(menu).toContain("/account/security");
});

test("the settings link stays when no navigation entry lists it", () => {
  expect(hrefs(menuAccountLinks(["/members/4"]))).toContain("/account");
});

test("every link of the account page is in the list the menu reads", () => {
  const all = ACCOUNT_GROUPS.flatMap((group) => group.links.map((l) => l.href));
  expect(hrefs(accountLinks())).toEqual(all);
});

// One list: neither the menu nor the account page spells out an account address of its own.
test("no menu file and no account navigation file repeats the address of an account screen", () => {
  const root = join(import.meta.dir, "..", "..", "..", "..");
  const files = [
    "components/layout/user-menu.tsx",
    "components/layout/user-menu-body.tsx",
    "components/layout/account-menu.tsx",
    "app/[locale]/(main)/account/navigation.tsx",
  ];
  for (const file of files) {
    const code = readFileSync(join(root, file), "utf8");
    for (const screen of [
      "privacy",
      "notifications",
      "preferences",
      "permissions",
      "security",
      "api",
    ]) {
      expect(code, `${file} ${screen}`).not.toContain(`/account/${screen}`);
    }
  }
});
