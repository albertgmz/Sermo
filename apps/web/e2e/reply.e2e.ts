import type { Page } from "@playwright/test";
import {
  box,
  editorReady,
  expect,
  expectFits,
  MEMBER_STATE,
  phoneWidth,
  ready,
  screen,
  seed,
  test,
  unique,
  visit,
} from "./fixtures";

test.use({ storageState: MEMBER_STATE });

const replyBox = (page: Page) =>
  page.getByRole("textbox", { name: "Type your message here." });

test("the reply editor's toolbar fits a phone, scrolls, and its buttons can be pressed @all", async ({
  page,
}) => {
  const { threadId } = seed();
  await visit(page, `/threads/${threadId}`);
  await replyBox(page).click();
  const reply = page.getByRole("region", { name: "Reply" });
  await editorReady(reply);
  const toolbar = reply.getByRole("toolbar", { name: "Formatting" });
  const size = screen(page);
  const frame = await box(toolbar);
  expect(frame.x).toBeGreaterThanOrEqual(0);
  expect(frame.x + frame.width).toBeLessThanOrEqual(size.width);
  await expectFits(page, "toolbar");

  // On a phone each button is a touch target (a tablet has the desktop size), and the last one is
  // reachable by scrolling the bar.
  const buttons = toolbar.getByRole("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(15);
  for (let index = 0; index < count; index += 1) {
    const size = await box(buttons.nth(index));
    const least = phoneWidth(page) ? 40 : 32;
    expect(size.width).toBeGreaterThanOrEqual(least);
    expect(size.height).toBeGreaterThanOrEqual(least);
  }
  await buttons.last().scrollIntoViewIfNeeded();
  const last = await box(buttons.last());
  expect(last.x + last.width).toBeLessThanOrEqual(size.width);

  // Bold wraps the typed word, and the BB code source shows it as text.
  const editor = replyBox(page);
  await editor.click();
  await editor.pressSequentially("phone");
  await editor.press("Control+A");
  await toolbar.getByRole("button", { name: "Bold" }).click();
  await toolbar.getByRole("button", { name: "BB code source" }).click();
  const source = reply.locator("textarea").first();
  await expect(source).toHaveValue(/\[B\]phone\[\/B\]/);
  await expectFits(page, "source");
  await source.fill("[I]changed[/I]");
  await toolbar.getByRole("button", { name: "BB code source" }).click();
  await expect(replyBox(page)).toContainText("changed");
  await expectFits(page, "back to rich text");
});

test("a reply is posted from the phone and the quote and r key reach the editor", async ({
  page,
}) => {
  const { threadId } = seed();
  await visit(page, `/threads/${threadId}?page=3`);

  // The r key focuses the reply box.
  await page.keyboard.press("r");
  await expect(replyBox(page)).toBeFocused();

  // The quote button puts the post into the box.
  await page.getByRole("button", { name: "Quote" }).first().click();
  await editorReady(page.getByRole("region", { name: "Reply" }));
  await expect(replyBox(page)).toContainText("[QUOTE=");

  const text = unique("Reply from the phone");
  await replyBox(page).press("Control+End");
  await replyBox(page).pressSequentially(text);
  await page.getByRole("button", { name: "Post reply" }).click();
  await expect(page.getByRole("article").filter({ hasText: text })).toHaveCount(
    1,
  );
  await expect(replyBox(page)).not.toContainText(text);
  await ready(page);
  await expectFits(page, "after the reply");
});
