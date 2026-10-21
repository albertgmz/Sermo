import type { Locator, Page } from "@playwright/test";
import {
  box,
  editorReady,
  expect,
  expectFits,
  MEMBER_STATE,
  ready,
  screen,
  seed,
  test,
  unique,
  visit,
} from "./fixtures";

test.use({ storageState: MEMBER_STATE });

const replyBox = (page: Page) =>
  page.getByRole("textbox", { name: "Write your reply…" });

const MORE = "More options…";

// The button of a command: in its group, or, when the bar is too narrow to show it there, in the
// strip one of the "⋮" opens (the strip is left open).
async function reveal(toolbar: Locator, command: string) {
  const button = toolbar.getByRole("button", { name: command, exact: true });
  if (await button.isVisible()) return button;
  const more = toolbar.getByRole("button", { name: MORE, exact: true });
  for (let index = 0; index < (await more.count()); index += 1) {
    const trigger = more.nth(index);
    if (!(await trigger.isVisible())) continue;
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
    if (await button.isVisible()) return button;
  }
  throw new Error(`${command} is nowhere in the bar`);
}

test("the reply editor's toolbar fits a phone without scrolling and its strips work @all", async ({
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
  // The bar has no scroll of its own: what does not fit is behind its "⋮".
  expect(
    await toolbar.evaluate((bar) => bar.scrollWidth <= bar.clientWidth),
  ).toBe(true);

  // XenForo's sizes at every width: 30 x 32 px buttons and a 22 px "⋮", each in view inside the
  // bar; the common commands are always buttons.
  const buttons = toolbar.getByRole("button");
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const control = buttons.nth(index);
    if (!(await control.isVisible())) continue;
    const button = await box(control);
    const more = (await control.getAttribute("aria-label")) === MORE;
    expect(button.width).toBeGreaterThanOrEqual(more ? 22 : 30);
    expect(button.height).toBeGreaterThanOrEqual(32);
    expect(button.x).toBeGreaterThanOrEqual(frame.x);
    expect(button.x + button.width).toBeLessThanOrEqual(frame.x + frame.width);
  }
  for (const command of ["Bold", "Italic", "Link", "Image", "Undo"]) {
    await expect(
      toolbar.getByRole("button", { name: command, exact: true }),
    ).toBeVisible();
  }

  // Bold wraps the typed word, and the editor keeps the focus and the selection.
  const editor = replyBox(page);
  await editor.click();
  await editor.pressSequentially("phone");
  await editor.press("Control+A");
  const bold = toolbar.getByRole("button", { name: "Bold", exact: true });
  await bold.click();
  await expect(editor).toBeFocused();
  await expect(bold).toHaveAttribute("aria-pressed", "true");

  // A "⋮" opens its strip under the groups and keeps the focus in the text; a second one closes
  // the first; Escape in a strip closes it with the focus back on its "⋮".
  const triggers = toolbar.getByRole("button", { name: MORE, exact: true });
  const shown: Locator[] = [];
  for (let index = 0; index < (await triggers.count()); index += 1) {
    if (await triggers.nth(index).isVisible()) shown.push(triggers.nth(index));
  }
  expect(shown.length).toBeGreaterThanOrEqual(1);
  const [first, second] = shown;
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(editor).toBeFocused();
  const strip = toolbar.locator(
    `[id="${await first.getAttribute("aria-controls")}"]`,
  );
  await expect(strip).toBeVisible();
  if (second) {
    await second.click();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(strip).toBeHidden();
    await second.click();
  } else {
    await first.click();
  }
  await expect(strip).toBeHidden();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(strip.getByRole("button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(strip).toBeHidden();
  await expect(first).toBeFocused();

  // The BB code source shows the bold word as text, and the rich text reads it back.
  await (await reveal(toolbar, "BB code source")).click();
  const source = reply.locator("textarea").first();
  await expect(source).toHaveValue(/\[B\]phone\[\/B\]/);
  await expect(source).toBeFocused();
  await expectFits(page, "source");
  await source.fill("[I]changed[/I]");
  await (await reveal(toolbar, "BB code source")).click();
  await expect(replyBox(page)).toContainText("changed");
  await expectFits(page, "back to rich text");

  // From the keyboard too, the source takes the focus into its field and the rich text takes it
  // back, whether the toggle is a button of its group or of the misc strip.
  const toggleByKey = async () => {
    await (await reveal(toolbar, "BB code source")).focus();
    await page.keyboard.press("Enter");
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
