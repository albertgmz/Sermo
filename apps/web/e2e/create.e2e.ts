import { readFileSync } from "node:fs";
import {
  createButton,
  expect,
  expectFits,
  MEMBER_STATE,
  ready,
  SEED_FILE,
  type Seed,
  test,
  unique,
  visit,
} from "./fixtures";

test.use({ storageState: MEMBER_STATE });

const seed = (): Seed => JSON.parse(readFileSync(SEED_FILE, "utf8"));

type Page = import("@playwright/test").Page;

const dialog = (page: Page) => page.getByRole("dialog", { name: "Create" });

async function openCreate(page: Page) {
  await createButton(page).click();
  await expect(dialog(page)).toBeVisible();
}

// The first forum of the list that the member may post in.
async function pickForum(page: Page) {
  const forums = dialog(page)
    .getByRole("list")
    .getByRole("button", { name: /^(?!Collapse|Expand)/ });
  await expect(forums.first()).toBeVisible();
  await forums.first().click();
}

test("the Create dialog offers four choices, Esc closes it and Back closes it @all", async ({
  page,
}) => {
  await visit(page, "/forums");
  await visit(page, "/");
  await openCreate(page);
  for (const name of [
    /^Discussion/,
    /^Question/,
    /^Poll or quiz/,
    /^Wall post/,
  ])
    await expect(dialog(page).getByRole("button", { name })).toBeVisible();
  await expectFits(page, "create dialog");

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(createButton(page)).toBeFocused();

  await openCreate(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/forums$/);
  await expect(dialog(page)).toBeHidden();
});

test("a discussion: the draft is kept when the dialog is closed and reopened, then it posts", async ({
  page,
}) => {
  await visit(page, "/");
  await openCreate(page);
  await dialog(page)
    .getByRole("button", { name: /^Discussion/ })
    .click();
  await pickForum(page);
  const title = unique("Discussion from the phone");
  await dialog(page).getByRole("textbox", { name: "Title" }).fill(title);
  const body = dialog(page).getByRole("textbox", {
    name: /^Write the first post/,
  });
  await body.click();
  await body.pressSequentially("The first post written on a phone.");
  await expectFits(page, "discussion composer");

  await dialog(page).getByRole("button", { name: "Close" }).click();
  await expect(dialog(page)).toBeHidden();
  await openCreate(page);
  await dialog(page)
    .getByRole("button", { name: /^Discussion/ })
    .click();
  await expect(
    dialog(page).getByRole("textbox", { name: "Title" }),
  ).toHaveValue(title);

  await dialog(page).getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/threads\/\d+/);
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await ready(page);
  await expectFits(page, "the new thread");
});

test("the thread page of a forum keeps its draft over a reload", async ({
  page,
}) => {
  const { forumId } = seed();
  test.skip(forumId === null, "the setup found no forum to post in");
  await visit(page, `/forums/${forumId}/new`);
  const title = unique("Draft title");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  const body = page.getByRole("textbox", { name: /^Write the first post/ });
  await body.click();
  await body.pressSequentially("A draft that survives a reload.");
  await page.waitForTimeout(1000);
  await page.reload();
  await ready(page);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(title);
  await expectFits(page, "restored draft");
});

test("a poll is made from the dialog and voted on", async ({ page }) => {
  await visit(page, "/");
  await openCreate(page);
  await dialog(page)
    .getByRole("button", { name: /^Poll or quiz/ })
    .click();
  await pickForum(page);
  const title = unique("Poll from the phone");
  const form = dialog(page);
  await form.getByRole("textbox", { name: "Title" }).fill(title);
  await form
    .getByRole("textbox", { name: "Question", exact: true })
    .fill("Tea or coffee?");
  await form.getByRole("textbox", { name: "Answer 1" }).fill("Tea");
  await form.getByRole("textbox", { name: "Answer 2" }).fill("Coffee");
  const body = form.getByRole("textbox", { name: /^Write the first post/ });
  await body.click();
  await body.pressSequentially("Which one?");
  await expectFits(page, "poll composer");
  await form.getByRole("button", { name: "Post", exact: true }).click();

  await expect(page).toHaveURL(/\/threads\/\d+/);
  const poll = page.getByRole("region", { name: "Poll", exact: true });
  await expect(
    poll.getByRole("heading", { name: "Tea or coffee?" }),
  ).toBeVisible();
  await expectFits(page, "the poll");
  await poll.getByRole("radio", { name: /^Tea/ }).check();
  await poll.getByRole("button", { name: "Vote", exact: true }).click();
  await expect(poll.getByText("1 voter")).toBeVisible();
  await expectFits(page, "the poll after voting");
});

test("a wall post is written from the dialog and lands on the member's wall", async ({
  page,
}) => {
  await visit(page, "/");
  await openCreate(page);
  await dialog(page)
    .getByRole("button", { name: /^Wall post/ })
    .click();
  const text = unique("Wall post from the phone");
  const box = dialog(page).getByRole("textbox", {
    name: "What's on your mind?",
  });
  await box.click();
  await box.pressSequentially(text);
  await expectFits(page, "wall composer");
  await dialog(page).getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/members\/\d+/);
  await expect(page.getByText(text)).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await expectFits(page, "the wall");
});
