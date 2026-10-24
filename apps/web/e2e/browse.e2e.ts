import {
  expect,
  expectFits,
  expectHeaderOnScreen,
  phoneWidth,
  rejectCookies,
  screen,
  seed,
  test,
  visit,
} from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

test("a guest goes from the feed to the forum list, a forum, a thread, a profile and search @all", async ({
  page,
}) => {
  await visit(page, "/novedades");
  await rejectCookies(page);
  await expect(
    page.getByRole("heading", { name: "What's new", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
  if (phoneWidth(page))
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  await expectFits(page, "feed");

  // The home page is the forum list: Home on a phone's bar, Forums in the header.
  if (phoneWidth(page)) {
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Home", exact: true })
      .click();
  } else {
    await page
      .getByRole("link", { name: "Forums", exact: true })
      .first()
      .click();
  }
  await expect(page).toHaveURL((url) => url.pathname === "/" && !url.search);
  await expectFits(page, "forums");

  const forum = page
    .locator('main a[href^="/forums/"]:not([aria-hidden])')
    .first();
  await expect(forum).toBeVisible();
  await forum.click();
  await expect(page).toHaveURL(/\/forums\/\d+/);
  await expectFits(page, "forum");

  const thread = page
    .locator('main a[href^="/threads/"]:not([aria-hidden])')
    .first();
  await expect(thread).toBeVisible();
  await thread.click();
  await expect(page).toHaveURL(/\/threads\/\d+/);
  await expect(page.getByRole("article").first()).toBeVisible();
  await expectFits(page, "thread");

  // A press on the author opens the member card; the card leads to the profile.
  await page
    .locator('article a[href^="/members/"]')
    .and(page.locator(":visible"))
    .first()
    .click();
  const card = page.getByRole("dialog", { name: /member card/ });
  await expect(card).toBeVisible();
  await expectFits(page, "member card");
  await card.getByRole("link", { name: "View profile" }).click();
  await expect(page).toHaveURL(/\/members\/\d+/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectFits(page, "profile");

  await page.goto("/search");
  await page.getByRole("searchbox", { name: "Keywords" }).fill("the");
  await page
    .getByRole("search")
    .getByRole("button", { name: "Search", exact: true })
    .click();
  await expect(page).toHaveURL(/q=the/);
  await expect(
    page.getByRole("heading", { name: "Posts", level: 2 }),
  ).toBeVisible();
  await expectFits(page, "search");
});

// "Create Account" is the longest label the header holds: at 360 px every control ends on the screen
// (the page and the cookie banner's layout viewport grew by 2 px when it did not).
test("a guest's English header fits the screen with every control whole @all", async ({
  page,
}) => {
  await visit(page, "/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "Create Account" }),
  ).toBeVisible();
  await expectHeaderOnScreen(page);
});

test("a thread of three pages: the first page, the last page and back @all", async ({
  page,
}) => {
  const { threadId } = seed();
  await visit(page, `/threads/${threadId}`);
  await rejectCookies(page);
  // The pager below the posts (a phone shows only that one, as XenForo does).
  const pages = page.getByRole("navigation", { name: "Pages" }).last();
  const current = pages.locator('[aria-current="page"]');
  await expect(current).toHaveText("1");
  const total = Number(await pages.getByRole("listitem").last().innerText());
  expect(total).toBeGreaterThan(1);
  await expectFits(page, "first page");

  for (let step = 1; step < total; step += 1) {
    await pages.getByRole("link", { name: "Next" }).click();
    await expect(current).toHaveText(String(step + 1));
  }
  await expect(pages.getByRole("link", { name: "Next" })).toHaveCount(0);
  await expect(page.getByRole("article").last()).toBeVisible();
  await expectFits(page, "last page");

  await pages.getByRole("link", { name: "Prev" }).click();
  await expect(current).toHaveText(String(total - 1));
  await expectFits(page, "previous page");
});

// The pager turns the posts in place: the screen is not loaded again (what the page holds in
// memory stays), the address names the page, and Back and Forward show the page they name.
test("a page number changes the posts in place, and Back and Forward follow the address @all", async ({
  page,
}) => {
  const { threadId } = seed();
  await visit(page, `/threads/${threadId}`);
  await rejectCookies(page);
  const pages = page.getByRole("navigation", { name: "Pages" }).last();
  const current = pages.locator('[aria-current="page"]');
  const firstPost = await page.getByRole("article").first().innerText();
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });

  await pages.getByRole("link", { name: "2", exact: true }).click();
  await expect(current).toHaveText("2");
  await expect(page).toHaveURL(new RegExp(`/threads/${threadId}\\?page=2$`));
  await expect(page.getByRole("article").first()).not.toHaveText(firstPost);
  // The posts start at the top of the screen.
  const top = await page
    .getByRole("article")
    .first()
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(top).toBeLessThan(screen(page).height);
  await expectFits(page, "page two in place");

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/threads/${threadId}$`));
  await expect(current).toHaveText("1");
  await expect(page.getByRole("article").first()).toHaveText(firstPost);
  await page.goForward();
  await expect(current).toHaveText("2");
  // Nothing of it loaded the screen again.
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);
});

test.describe("without scripts", () => {
  test.use({ javaScriptEnabled: false });

  test("the pager's page numbers are plain links @all", async ({ page }) => {
    const { threadId } = seed();
    await page.goto(`/threads/${threadId}`);
    const pages = page.getByRole("navigation", { name: "Pages" }).last();
    await pages.getByRole("link", { name: "2", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/threads/${threadId}\\?page=2$`));
    await expect(pages.locator('[aria-current="page"]')).toHaveText("2");
  });
});
