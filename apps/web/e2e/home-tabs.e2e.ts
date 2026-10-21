import type { Page } from "@playwright/test";
import { expect, MEMBER_STATE, phoneWidth, test, visit } from "./fixtures";

// Every cell of the phone bar (tabs and the menu button) sits on one line inside the bar, and the
// bar inside the screen: nothing wraps, nothing is cut.
async function expectBarFits(page: Page, label: string) {
  const bar = page.getByRole("navigation", {
    name: /^(What's new tabs|Pestañas de novedades)$/,
  });
  await expect(bar).toBeVisible();
  const found = await bar.evaluate((nav) => {
    const frame = nav.getBoundingClientRect();
    return {
      screen: window.innerWidth,
      right: frame.right,
      cells: [...nav.querySelectorAll("a, button")].map((cell) => {
        const box = cell.getBoundingClientRect();
        return {
          name: cell.textContent,
          right: box.right,
          height: box.height,
          cut: cell.scrollWidth > cell.clientWidth,
        };
      }),
    };
  });
  expect(found.right, `${label}: bar`).toBeLessThanOrEqual(found.screen);
  for (const cell of found.cells) {
    expect(cell.right, `${label}: ${cell.name}`).toBeLessThanOrEqual(
      found.right,
    );
    expect(cell.cut, `${label}: ${cell.name} cut`).toBe(false);
    expect(cell.height, `${label}: ${cell.name} height`).toBe(
      found.cells[0].height,
    );
  }
}

async function everyTab(page: Page, tabs: string[], language: string) {
  for (const tab of tabs) {
    await visit(page, `/novedades?tab=${tab}`);
    await expectBarFits(page, `${language} ${tab}`);
  }
}

async function inSpanish(page: Page) {
  await page
    .context()
    .addCookies([{ name: "forum_locale", value: "es", url: page.url() }]);
}

test.describe("guest", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a guest's feed tabs fit a phone on one line, in English and Spanish @all", async ({
    page,
  }) => {
    test.skip(!phoneWidth(page), "the phone bar is drawn below md only");
    await visit(page, "/novedades");
    const tabs = ["latest", "hot", "media"];
    await everyTab(page, tabs, "en");
    await inSpanish(page);
    await everyTab(page, tabs, "es");
  });
});

test.describe("member", () => {
  test.use({ storageState: MEMBER_STATE });

  test("a member's feed tabs fit a phone on one line, and there is no wall composer @all", async ({
    page,
  }) => {
    test.skip(!phoneWidth(page), "the phone bar is drawn below md only");
    await visit(page, "/novedades?tab=latest");
    // The member may post on their wall, so the composer is in the page; a phone does not show it.
    const composer = page.locator(
      'section[aria-label="New post"], section[aria-label="Nueva publicación"]',
    );
    await expect(composer).toHaveCount(1);
    await expect(composer).toBeHidden();
    const tabs = ["latest", "hot", "following", "media"];
    await everyTab(page, tabs, "en");
    await inSpanish(page);
    await everyTab(page, tabs, "es");
  });
});
