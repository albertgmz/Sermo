import { readFileSync } from "node:fs";
import {
  expect,
  expectFits,
  phoneWidth,
  rejectCookies,
  SEED_FILE,
  type Seed,
  test,
  visit,
} from "./fixtures";

const seed = (): Seed => JSON.parse(readFileSync(SEED_FILE, "utf8"));

test.use({ storageState: { cookies: [], origins: [] } });

test("a guest goes from the home feed to a forum, a thread, a profile and search @all", async ({
  page,
}) => {
  await visit(page, "/");
  await rejectCookies(page);
  await expect(
    page.getByRole("heading", { name: "Home", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
  if (phoneWidth(page))
    await expect(
      page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
  await expectFits(page, "home");

  await page.getByRole("link", { name: "Forums", exact: true }).first().click();
  await expect(page).toHaveURL(/\/forums$/);
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

test("a thread of three pages: the first page, the last page and back @all", async ({
  page,
}) => {
  const { threadId } = seed();
  test.skip(threadId === null, "the setup could not make a long thread");
  await visit(page, `/threads/${threadId}`);
  await rejectCookies(page);
  const pages = page.getByRole("navigation", { name: "Pages" });
  await expect(pages.getByText(/Page 1 of \d+/)).toBeVisible();
  const total = Number((await pages.innerText()).match(/of (\d+)/)?.[1]);
  expect(total).toBeGreaterThan(1);
  await expectFits(page, "first page");

  for (let step = 1; step < total; step += 1) {
    await pages.getByRole("link", { name: "Next" }).click();
    await expect(pages.getByText(`Page ${step + 1} of ${total}`)).toBeVisible();
  }
  await expect(pages.getByRole("link", { name: "Next" })).toHaveCount(0);
  await expect(page.getByRole("article").last()).toBeVisible();
  await expectFits(page, "last page");

  await pages.getByRole("link", { name: "Previous" }).click();
  await expect(pages.getByText(`Page ${total - 1} of ${total}`)).toBeVisible();
  await expectFits(page, "previous page");
});
