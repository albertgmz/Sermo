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

// The menu always opens on Account, where the theme buttons are; the tab is chosen again to be sure.
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

    // The two tabs show their own panel (Messages and Alerts are header and phone bar buttons).
    const tabs = menu.getByRole("tablist", { name: "Account menu sections" });
    for (const name of ["Bookmarks", "Account"]) {
      await tabs.getByRole("tab", { name }).click();
      await expect(tabs.getByRole("tab", { name })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      // The panel of the tab just chosen: the one that is leaving is still there while it animates.
      await expect(menu.getByRole("tabpanel", { name })).toBeVisible();
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
    const theme = menu.getByRole("combobox", { name: "Theme" });
    await theme.selectOption("dark");
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await expect(theme).toHaveValue("dark");
    await page.keyboard.press("Escape");
    await expectFits(page, "dark");

    await page.reload();
    await ready(page);
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await expectFits(page, "dark after a reload");

    await openAccountTab(page);
    await menu.getByRole("combobox", { name: "Theme" }).selectOption("light");
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    await page.keyboard.press("Escape");
    await expectFits(page, "light");
  });
});

test.describe("guest", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a guest with no choice follows the device, and a choice is kept over a reload @all", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await visit(page, "/");
    await rejectCookies(page);
    const theme = page.getByRole("combobox", { name: "Theme" });
    await expect(theme).toHaveValue("system");
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    await ready(page);
    await expect(html(page)).toHaveAttribute("data-theme", "light");

    await theme.selectOption("dark");
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await expectFits(page, "guest dark");
    await page.reload();
    await ready(page);
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await theme.selectOption("light");
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    await expectFits(page, "guest light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await ready(page);
    await expect(html(page)).toHaveAttribute("data-theme", "light");

    await theme.selectOption("system");
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
  });
});
