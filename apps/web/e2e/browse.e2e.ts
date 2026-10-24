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

// A thread's address as the server settles it: the id, then its slug.
const threadAt = (threadId: number, query = "") =>
  new RegExp(`/threads/${threadId}(-[^/?]+)?${query.replace("?", "\\?")}$`);

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
  const firstPost = page.getByRole("article").first();
  // The pager is part of what changes: once it names the page, the posts are that page's.
  const onPage = async (number: number) => {
    await expect(current).toHaveText(String(number));
    await expect(page).toHaveURL(
      threadAt(threadId, number > 1 ? `?page=${number}` : ""),
    );
    // The post's own id, not its text: the text holds a time ("39 seconds ago") that moves on.
    return firstPost.getAttribute("id");
  };
  const one = await onPage(1);
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });

  await pages.getByRole("link", { name: "2", exact: true }).click();
  const two = await onPage(2);
  expect(two).not.toBe(one);
  // The posts start on the screen, not where the pager below them was.
  const top = await firstPost.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(top).toBeLessThan(screen(page).height);
  await expectFits(page, "page two in place");
  await pages.getByRole("link", { name: "3", exact: true }).click();
  const three = await onPage(3);
  expect(three).not.toBe(two);

  await page.goBack();
  expect(await onPage(2)).toBe(two);
  await page.goBack();
  expect(await onPage(1)).toBe(one);
  await page.goForward();
  expect(await onPage(2)).toBe(two);
  await page.goForward();
  expect(await onPage(3)).toBe(three);
  // Nothing of it loaded the screen again.
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);
});

// The search results are numbered pages like a thread's: a page number turns them in place, the
// query stays in the box, and the address names the page.
test("the pages of the search results turn in place and keep the query @all", async ({
  page,
}) => {
  seed();
  // The pager thread's hundred replies all say "Pager"; the search index is written by a background
  // job, so look again until the first page has a pager.
  const pages = page.getByRole("navigation", { name: "Pages" }).last();
  await expect(async () => {
    await page.goto("/search?q=Pager");
    await expect(pages).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await rejectCookies(page);
  const current = pages.locator('[aria-current="page"]');
  await expect(current).toHaveText("1");
  const firstResult = page.locator("main article").first();
  // The result's first link, not its text: the text holds a time ("39 seconds ago") that moves on.
  const resultLink = () =>
    firstResult.locator("a[href]").first().getAttribute("href");
  const one = await resultLink();
  await page.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });

  await pages.getByRole("link", { name: "2", exact: true }).click();
  await expect(current).toHaveText("2");
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/search" &&
      url.searchParams.get("q") === "Pager" &&
      url.searchParams.get("page") === "2",
  );
  expect(await resultLink()).not.toBe(one);
  await expect(page.locator("#search-query")).toHaveValue("Pager");
  await page.goBack();
  await expect(current).toHaveText("1");
  expect(await resultLink()).toBe(one);
  // Nothing of it loaded the screen again.
  expect(
    await page.evaluate(() => (window as unknown as { kept?: boolean }).kept),
  ).toBe(true);
});

// "Go to page" sits behind the "…" of a thread of six pages: a number within the pages opens that
// page, one past them the last page, and what is not a number opens nothing.
test("go to page takes a page number, brings one out of range to the last page and refuses the rest @all", async ({
  page,
}) => {
  const { pagerThreadId } = seed();
  await visit(page, `/threads/${pagerThreadId}`);
  await rejectCookies(page);
  const pages = page.getByRole("navigation", { name: "Pages" }).last();
  const current = pages.locator('[aria-current="page"]');
  const total = Number(await pages.getByRole("listitem").last().innerText());
  expect(total).toBeGreaterThanOrEqual(6);
  const open = async () => {
    await pages.locator("summary:visible").first().click();
    const box = pages.getByRole("spinbutton", { name: "Go to page" });
    await expect(box).toBeFocused();
    return box;
  };

  // Not a number: the page stays and the box stays open.
  let box = await open();
  await box.fill("");
  await box.press("Enter");
  await expect(box).toBeVisible();
  await expect(current).toHaveText("1");
  await expect(page).toHaveURL(threadAt(pagerThreadId));

  // Past the last page: the last page.
  await box.fill("999");
  await pages.getByRole("button", { name: "Go", exact: true }).click();
  await expect(current).toHaveText(String(total));
  await expect(page).toHaveURL(threadAt(pagerThreadId, `?page=${total}`));
  await expect(box).toBeHidden();

  // A page within them.
  box = await open();
  await box.fill("3");
  await box.press("Enter");
  await expect(current).toHaveText("3");
  await expect(page).toHaveURL(threadAt(pagerThreadId, "?page=3"));
});

// The pager works before the page's scripts have run (a slow phone) and without them: the inline
// scripts that draw the streamed page still run, the page's own are kept from loading (see
// native-forms.e2e.ts).
test.describe("without the page's scripts", () => {
  test.use({ allowConsoleErrors: true, serviceWorkers: "block" });

  test("the pager's page numbers are plain links and go to page is a form @all", async ({
    page,
  }) => {
    await page
      .context()
      .route("**/_next/static/chunks/*.js", (route) => route.abort());
    const { threadId, pagerThreadId } = seed();
    await page.goto(`/threads/${threadId}`);
    const pages = page.getByRole("navigation", { name: "Pages" }).last();
    await pages.getByRole("link", { name: "2", exact: true }).click();
    await expect(page).toHaveURL(threadAt(threadId, "?page=2"));
    await expect(pages.locator('[aria-current="page"]')).toHaveText("2");

    await page.goto(`/threads/${pagerThreadId}`);
    await pages.locator("summary:visible").first().click();
    const box = pages.getByRole("spinbutton", { name: "Go to page" });
    await box.fill("4");
    await box.press("Enter");
    await expect(page).toHaveURL(threadAt(pagerThreadId, "?page=4"));
    await expect(pages.locator('[aria-current="page"]')).toHaveText("4");
  });
});
