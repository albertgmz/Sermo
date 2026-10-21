import type { Page } from "@playwright/test";
import {
  box as boxOf,
  createButton,
  editorReady,
  expect,
  expectFits,
  MEMBER_STATE,
  ready,
  seed,
  test,
  unique,
  visit,
} from "./fixtures";

test.use({ storageState: MEMBER_STATE });

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
  await visit(page, "/members");
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
  await expect(page).toHaveURL(/\/members$/);
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
  await visit(page, `/forums/${forumId}/new`);
  const title = unique("Draft title");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  const body = page.getByRole("textbox", { name: /^Write the first post/ });
  await body.click();
  await body.pressSequentially("A draft that survives a reload.");
  // The draft is written to the tab's storage a moment after the typing.
  await page.waitForFunction(
    (text) =>
      Object.keys(sessionStorage).some(
        (key) =>
          key.startsWith("sermo:thread-draft:") &&
          sessionStorage.getItem(key)?.includes(text),
      ),
    title,
  );
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

test("in the Create dialog a press below the text puts the caret at its end, and a selection is not undone by the press that ends it", async ({
  page,
}) => {
  await visit(page, "/");
  await openCreate(page);
  await dialog(page)
    .getByRole("button", { name: /^Wall post/ })
    .click();
  const text = dialog(page).getByRole("textbox", {
    name: "What's on your mind?",
  });
  await text.click();
  await text.pressSequentially("First words");
  await editorReady(dialog(page));
  const blank = dialog(page).locator("[data-composer-grow]");
  // The text takes the screen down to the bar of tools.
  const frame = await boxOf(blank);
  const written = await boxOf(text);
  expect(frame.y + frame.height).toBeGreaterThan(
    written.y + written.height + 100,
  );

  // The caret at the start, then a press well below the text: typing goes on at the end.
  await page.keyboard.press("Home");
  await page.mouse.click(
    frame.x + frame.width / 2,
    frame.y + frame.height - 20,
  );
  await page.keyboard.type(" and more");
  await expect(text).toHaveText("First words and more");

  // A selection that ends in the blank part (its click lands on the frame, with no press there
  // first) stays as the member made it.
  await page.keyboard.press("Shift+Home");
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("First words and more");
  await blank.dispatchEvent("click");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    "First words and more",
  );
  await expectFits(page, "grown wall composer");
});
