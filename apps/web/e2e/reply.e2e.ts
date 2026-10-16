import type { Locator, Page } from "@playwright/test";
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

// Turns a command on or off from its button, or, when the bar is too narrow to show it, from the
// menu that holds it.
async function choose(
  page: Page,
  toolbar: Locator,
  menu: string,
  command: string,
) {
  const button = toolbar.getByRole("button", { name: command, exact: true });
  if (await button.isVisible()) {
    await button.click();
    return;
  }
  await toolbar.getByRole("button", { name: menu, exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: command, exact: true })
    .click();
  await expect(page.getByRole("menu")).toBeHidden();
}

test("the reply editor's toolbar fits a phone without scrolling and its menu items work @all", async ({
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
  // The bar has no scroll of its own: what does not fit is in its menus.
  expect(
    await toolbar.evaluate((bar) => bar.scrollWidth <= bar.clientWidth),
  ).toBe(true);

  // On a phone each button is a touch target (a tablet has the desktop size), and every one is in
  // view inside the bar.
  const buttons = toolbar.getByRole("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(6);
  for (let index = 0; index < count; index += 1) {
    const button = await box(buttons.nth(index));
    const least = phoneWidth(page) ? 40 : 32;
    expect(button.width).toBeGreaterThanOrEqual(least);
    expect(button.height).toBeGreaterThanOrEqual(least);
    expect(button.x).toBeGreaterThanOrEqual(frame.x);
    expect(button.x + button.width).toBeLessThanOrEqual(frame.x + frame.width);
  }

  // Bold wraps the typed word, and the editor keeps the focus and the selection.
  const editor = replyBox(page);
  await editor.click();
  await editor.pressSequentially("phone");
  await editor.press("Control+A");
  await choose(page, toolbar, "Text", "Bold");
  await expect(editor).toBeFocused();

  // The Text menu shows what is on, and Escape closes it with the focus back on its button.
  const text = toolbar.getByRole("button", { name: "Text", exact: true });
  await text.click();
  const bold = toolbar.getByRole("button", { name: "Bold", exact: true });
  if (await bold.isVisible()) {
    await expect(bold).toHaveAttribute("aria-pressed", "true");
  } else {
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Bold", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(text).toBeFocused();

  // The BB code source shows the bold word as text, and the rich text reads it back.
  await choose(page, toolbar, "More", "BB code source");
  const source = reply.locator("textarea").first();
  await expect(source).toHaveValue(/\[B\]phone\[\/B\]/);
  await expect(source).toBeFocused();
  await expectFits(page, "source");
  await source.fill("[I]changed[/I]");
  await choose(page, toolbar, "More", "BB code source");
  await expect(replyBox(page)).toContainText("changed");
  await expectFits(page, "back to rich text");

  // From the keyboard too, the source takes the focus into its field and the rich text takes it
  // back, whether the toggle is a button or an item of the More menu; the focus stays there once
  // the menu has gone.
  const more = toolbar.getByRole("button", { name: "More", exact: true });
  const toggleByKey = async () => {
    if (await more.isVisible()) {
      await more.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("menuitemcheckbox", { name: "BB code source" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu")).toBeHidden();
    } else {
      await toolbar
        .getByRole("button", { name: "BB code source", exact: true })
        .focus();
      await page.keyboard.press("Enter");
    }
  };
  await toggleByKey();
  await expect(source).toBeFocused();
  await toggleByKey();
  await expect(replyBox(page)).toBeFocused();
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
