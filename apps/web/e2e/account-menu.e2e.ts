import type { Page } from "@playwright/test";
import {
  box,
  expect,
  expectFits,
  MEMBER_STATE,
  phoneWidth,
  ready,
  rejectCookies,
  screen,
  test,
  visit,
} from "./fixtures";

const html = (page: Page) => page.locator("html");

// The menu opens on the tab with something unread, which is the alerts of a member who has some:
// the theme buttons are on the Account tab.
async function openAccountTab(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  const menu = page.getByRole("dialog", { name: "Account menu" });
  await menu
    .getByRole("tablist", { name: "Account menu sections" })
    .getByRole("tab", { name: "Account" })
    .click();
  return menu;
}

test.describe("signed in", () => {
  test.use({ storageState: MEMBER_STATE });

  test("the account menu is a sheet on a phone and a popover on a tablet @all", async ({
    page,
  }) => {
    await visit(page, "/");
    const trigger = page.getByRole("button", { name: "Account menu" });
    await trigger.click();
    const menu = page.getByRole("dialog", { name: "Account menu" });
    await expect(menu).toBeVisible();
    await expectFits(page, "account menu");
    // The sheet slides up: wait until it stops.
    const size = screen(page);
    if (phoneWidth(page)) {
      await expect
        .poll(async () => {
          const frame = await box(menu);
          return Math.round(frame.y + frame.height);
        })
        .toBe(size.height);
      const frame = await box(menu);
      expect(Math.round(frame.x)).toBe(0);
      expect(Math.round(frame.width)).toBe(size.width);
    } else {
      const frame = await box(menu);
      expect(frame.width).toBeLessThan(size.width);
      expect(frame.y + frame.height).toBeLessThan(size.height);
    }

    // The four tabs show their own panel.
    const tabs = menu.getByRole("tablist", { name: "Account menu sections" });
    for (const name of ["Alerts", "Conversations", "Bookmarks", "Account"]) {
      await tabs.getByRole("tab", { name }).click();
      await expect(tabs.getByRole("tab", { name })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(menu.getByRole("tabpanel")).toBeVisible();
      await expectFits(page, `tab ${name}`);
    }
    await expect(menu.getByRole("link", { name: /^Data saver/ })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("the status line of the menu is written and can be sent", async ({
    page,
  }) => {
    await visit(page, "/");
    await page.getByRole("button", { name: "Account menu" }).click();
    const menu = page.getByRole("dialog", { name: "Account menu" });
    const status = menu.getByRole("textbox", { name: "Update your status" });
    await status.fill("Status from a phone");
    await expect(
      menu.getByRole("button", { name: "Post status" }),
    ).toBeEnabled();
    await expectFits(page, "status");
  });

  test("the theme is chosen in the account menu, kept over a reload, light and dark @all", async ({
    page,
  }) => {
    await visit(page, "/");
    const menu = await openAccountTab(page);
    const group = menu.getByRole("group", { name: "Theme" });
    await group.getByRole("button", { name: "Dark" }).click();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await expect(group.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Escape");
    await expectFits(page, "dark");

    await page.reload();
    await ready(page);
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await expectFits(page, "dark after a reload");

    await openAccountTab(page);
    await menu
      .getByRole("group", { name: "Theme" })
      .getByRole("button", { name: "Light" })
      .click();
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    await page.keyboard.press("Escape");
    await expectFits(page, "light");
    // Back to following the system, as the other flows expect.
    await openAccountTab(page);
    await menu
      .getByRole("group", { name: "Theme" })
      .getByRole("button", { name: "System" })
      .click();
  });
});

test.describe("guest", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a guest chooses the theme in the footer, and the system choice follows the device @all", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    // The forum list, not the feed: the footer of an endless list keeps moving down as the next
    // pages load while it is scrolled to, and a press lands where the button was.
    await visit(page, "/forums");
    await rejectCookies(page);
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    await ready(page);
    await expect(html(page)).toHaveAttribute("data-theme", "light");

    const theme = page.getByRole("group", { name: "Theme" });
    await theme.getByRole("button", { name: "Dark" }).click();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await expectFits(page, "guest dark");
    await page.reload();
    await ready(page);
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await theme.getByRole("button", { name: "Light" }).click();
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    await expectFits(page, "guest light");
  });
});
