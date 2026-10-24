import type { Page } from "@playwright/test";
import {
  expect,
  MEMBER_STATE,
  PEER,
  rejectCookies,
  seed,
  test,
  visit,
} from "./fixtures";

// The parts of a page that change in place (tabs, a list's next posts, a popover) change only
// themselves: the screen is not loaded again, the rest of it stays the same elements, no
// placeholder takes the place of what was there, and the scroll position stays.

type Watch = { kept?: boolean; skeletons?: number; header?: Element | null };

// Marks the screen as it is now: a flag in its memory, the site header's element, and a count of
// the placeholders drawn from here on.
async function watch(page: Page) {
  await page.evaluate(() => {
    const own = window as unknown as Watch;
    own.kept = true;
    own.skeletons = 0;
    own.header = document.querySelector("body header");
    new MutationObserver((changes) => {
      for (const change of changes)
        for (const node of change.addedNodes)
          if (
            node instanceof Element &&
            (node.matches('[data-slot="skeleton"]') ||
              node.querySelector('[data-slot="skeleton"]'))
          )
            own.skeletons = (own.skeletons ?? 0) + 1;
    }).observe(document.body, { childList: true, subtree: true });
  });
}

// The screen is the one `watch` marked, its header the same element, and no placeholder showed.
async function expectInPlace(page: Page, label: string) {
  const state = await page.evaluate(() => {
    const own = window as unknown as Watch;
    return {
      kept: own.kept === true,
      header: own.header?.isConnected === true,
      skeletons: own.skeletons ?? -1,
    };
  });
  expect(state, label).toEqual({ kept: true, header: true, skeletons: 0 });
}

// The requests that draw a whole screen again: a page's own data (Next asks for it with the `rsc`
// header), not a server action (which carries `next-action`) nor a link's prefetch.
function screenLoads(page: Page) {
  const loads: string[] = [];
  page.on("request", (request) => {
    const headers = request.headers();
    if (
      headers.rsc &&
      !headers["next-action"] &&
      !headers["next-router-prefetch"] &&
      !headers["next-router-segment-prefetch"]
    )
      loads.push(request.url());
  });
  return loads;
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test.describe("signed in", () => {
  test.use({ storageState: MEMBER_STATE });

  test("a profile's About tab opens in place under the header, and Back brings the wall back @all", async ({
    page,
  }) => {
    const { landing } = seed();
    await visit(page, `/members/${landing.memberId}`);
    await rejectCookies(page);
    const profile = new URL(page.url()).pathname;
    const tabs = page.getByRole("navigation", { name: "Profile sections" });
    await expect(tabs.locator('[aria-current="page"]')).toHaveText(/Wall/);
    await watch(page);
    const loads = screenLoads(page);
    const before = await scrollY(page);

    await tabs.getByRole("link", { name: "About", exact: true }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === profile && url.search === "?tab=about",
    );
    await expect(tabs.locator('[aria-current="page"]')).toHaveText("About");
    await expect(
      page.getByRole("heading", { name: "About", exact: true }),
    ).toBeVisible();
    await expectInPlace(page, "about");
    expect(await scrollY(page)).toBe(before);
    // The tab keeps the keyboard where it was pressed.
    await expect(
      tabs.getByRole("link", { name: "About", exact: true }),
    ).toBeFocused();

    await page.goBack();
    await expect(page).toHaveURL(
      (url) => url.pathname === profile && url.search === "",
    );
    await expect(tabs.locator('[aria-current="page"]')).toHaveText(/Wall/);
    await expect(
      page.locator(`#profile-post-${landing.wall.newestPostId}`),
    ).toBeVisible();
    await expectInPlace(page, "back to the wall");
    expect(loads).toEqual([]);
  });

  test("Load more on a profile wall puts the next posts under those shown, in place @all", async ({
    page,
  }) => {
    const { landing } = seed();
    await visit(page, `/members/${landing.memberId}`);
    await rejectCookies(page);
    const newest = page.locator(`#profile-post-${landing.wall.newestPostId}`);
    await expect(newest).toBeVisible();
    // The rows of the list are numbered; the list draws those near the screen.
    const lastRow = () =>
      page
        .locator("[data-index]")
        .evaluateAll((rows) =>
          Math.max(
            ...rows.map((row) => Number(row.getAttribute("data-index"))),
          ),
        );
    const shown = await lastRow();
    await watch(page);
    const loads = screenLoads(page);

    const more = page.getByRole("link", { name: "Load more", exact: true });
    await more.scrollIntoViewIfNeeded();
    const before = await scrollY(page);
    await more.click();
    await expect(page).toHaveURL(/[?&]pages=2(&|$)/);
    await expect.poll(lastRow).toBeGreaterThan(shown);
    // The screen did not move up to the top, and the posts shown before are still above.
    expect(await scrollY(page)).toBeGreaterThanOrEqual(before);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(newest).toBeVisible();
    await expectInPlace(page, "wall load more");
    expect(loads).toEqual([]);
  });

  test("who reacted opens over a wall post and changes nothing else on the screen @all", async ({
    page,
  }) => {
    const { landing } = seed();
    await visit(page, `/members/${landing.memberId}`);
    await rejectCookies(page);
    const summary = page
      .getByRole("button", { name: /show who reacted/ })
      .first();
    await summary.scrollIntoViewIfNeeded();
    await watch(page);
    const loads = screenLoads(page);
    const redrawn: string[] = [];
    page.on("response", (response) => {
      if (response.headers()["x-action-revalidated"])
        redrawn.push(response.url());
    });
    const before = await scrollY(page);

    await summary.click();
    const popover = page.getByRole("dialog");
    await expect(popover.getByRole("link", { name: PEER })).toBeVisible();
    await expectInPlace(page, "who reacted");
    expect(await scrollY(page)).toBe(before);
    // The list came from its own action, which drew nothing else again.
    expect(redrawn).toEqual([]);
    expect(loads).toEqual([]);
  });

  test("a feed tab opens in place: the composer and the side column stay as they are @all", async ({
    page,
  }) => {
    await visit(page, "/novedades?tab=latest");
    await rejectCookies(page);
    const bar = page
      .getByRole("navigation", { name: "What's new tabs" })
      .and(page.locator(":visible"));
    await watch(page);
    const loads = screenLoads(page);
    await bar.getByRole("link", { name: "Trending" }).click();
    await expect(page).toHaveURL((url) => url.search === "?tab=hot");
    await expect(bar.locator('[aria-current="page"]')).toContainText(
      "Trending",
    );
    // The page's title names the tab, as a page load of the address would.
    await expect(page).toHaveTitle(/^Trending threads/);
    await expectInPlace(page, "trending");

    await page.goBack();
    await expect(page).toHaveURL((url) => url.search === "?tab=latest");
    await expect(bar.locator('[aria-current="page"]')).toContainText("Latest");
    await expect(page).toHaveTitle(/^Latest threads and posts/);
    await expectInPlace(page, "back to latest");
    expect(loads).toEqual([]);
  });
});

// Without the page's scripts the tabs and Load more are plain links (see native-forms.e2e.ts).
test.describe("without the page's scripts", () => {
  test.use({
    allowConsoleErrors: true,
    serviceWorkers: "block",
    storageState: MEMBER_STATE,
  });

  test("a profile's tabs and its wall's Load more are plain links @all", async ({
    page,
  }) => {
    await page
      .context()
      .route("**/_next/static/chunks/*.js", (route) => route.abort());
    const { landing } = seed();
    await page.goto(`/members/${landing.memberId}`);
    const tabs = page.getByRole("navigation", { name: "Profile sections" });
    await page.getByRole("link", { name: "Load more", exact: true }).click();
    await expect(page).toHaveURL(/[?&]cursor=/);
    await tabs.getByRole("link", { name: "About", exact: true }).click();
    await expect(page).toHaveURL(/\?tab=about$/);
    await expect(tabs.locator('[aria-current="page"]')).toHaveText("About");
  });
});
