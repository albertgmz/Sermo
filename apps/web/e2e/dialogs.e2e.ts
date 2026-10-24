import type { Page } from "@playwright/test";
import {
  expect,
  expectFits,
  MEMBER_STATE,
  ready,
  rejectCookies,
  seed,
  test,
  unique,
  visit,
} from "./fixtures";

test.use({ storageState: MEMBER_STATE });

// Delete and Report open over the page as XenForo's overlays: the focus goes to the reason, Escape,
// Cancel and a press outside close them, and the focus goes back to the button. Edit tags and the
// poll editor open in place, take the focus to their first field, close on Escape, and only one of
// them is open at a time.

const origin = (page: Page) => new URL(page.url()).origin;

// A press on the dimmed page beside the dialog.
const pressOutside = (page: Page) => page.mouse.click(4, 4);

test("Report opens a dialog over the page that takes the focus and hands it back", async ({
  page,
}) => {
  const { peerThreadId } = seed();
  await visit(page, `/threads/${peerThreadId}`);
  await rejectCookies(page);
  await ready(page);
  const report = page
    .getByRole("article")
    .first()
    .getByRole("button", { name: "Report" });
  const dialog = page.getByRole("dialog", { name: "Report content" });
  const reason = dialog.getByRole("textbox", {
    name: "Why are you reporting this?",
  });

  await report.click();
  await expect(reason).toBeFocused();
  await expectFits(page, "the report dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(report).toBeFocused();

  await report.click();
  await expect(reason).toBeFocused();
  await pressOutside(page);
  await expect(dialog).toBeHidden();
  await expect(report).toBeFocused();

  await report.click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(report).toBeFocused();

  // Filed, it closes and a notice thanks the member.
  await report.click();
  await reason.fill(unique("Checking the report dialog"));
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("Thank you. The moderators will look at this.").first(),
  ).toBeVisible();
});

test("Delete opens the delete dialog over the page, and deletes from it", async ({
  page,
}) => {
  const { threadId } = seed();
  await page.goto("/cookies");
  const words = unique("A reply deleted from the dialog");
  const reply = await page.request.post(`/api/v1/threads/${threadId}/posts`, {
    data: { body: words },
    headers: { origin: origin(page) },
  });
  expect(reply.ok(), "the reply is posted").toBe(true);
  const { id } = (await reply.json()) as { id: number };
  await visit(page, `/posts/${id}`);
  await rejectCookies(page);
  await ready(page);
  const remove = page
    .locator(`#post-${id}`)
    .getByRole("button", { name: "Delete", exact: true });
  const dialog = page.getByRole("dialog", { name: "Delete content" });
  const reason = dialog.getByRole("textbox", { name: "Reason (optional)" });

  await remove.click();
  await expect(reason).toBeFocused();
  await expectFits(page, "the delete dialog");
  // Modal: the page under it takes no press, and the press closes the dialog.
  await pressOutside(page);
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(reason).toBeFocused();
  await reason.fill("Checking the dialog");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(words)).toHaveCount(0);
});

test("Edit tags and the poll editor open in place on their first field, one at a time, and close on Escape", async ({
  page,
}) => {
  const { forumId } = seed();
  await page.goto("/cookies");
  const made = await page.request.post(`/api/v1/nodes/${forumId}/threads`, {
    data: { title: unique("Tags and poll"), body: "A thread to tag." },
    headers: { origin: origin(page) },
  });
  expect(made.ok(), "the thread is made").toBe(true);
  const { thread } = (await made.json()) as { thread: { id: number } };
  await visit(page, `/threads/${thread.id}`);
  await rejectCookies(page);
  await ready(page);
  const addTags = page.getByRole("button", { name: "Add tags" });
  const tags = page.getByRole("textbox", { name: "Tags" });
  const addPoll = page.getByRole("button", { name: "Add a poll or quiz" });
  const question = page
    .getByRole("region", { name: "Poll or quiz" })
    .getByRole("textbox", { name: "Question" });

  await addTags.click();
  await expect(tags).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tags).toHaveCount(0);
  await expect(addTags).toBeFocused();

  // Opening the poll editor closes the tags.
  await page.keyboard.press("Enter");
  await expect(tags).toBeFocused();
  await addPoll.click();
  await expect(question).toBeFocused();
  await expect(tags).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(addPoll).toBeFocused();
});
