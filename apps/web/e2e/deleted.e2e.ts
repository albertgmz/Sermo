import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import {
  chooseLanguage,
  expect,
  expectFits,
  MEMBER_STATE,
  PASSWORD,
  rejectCookies,
  seed,
  test,
  unique,
  visit,
} from "./fixtures";

test.use({ storageState: MEMBER_STATE });

// A deleted item is folded to one line for the staff who see it, as XenForo draws it ("Deleted by
// X · when · Reason: Y", Show…), opens in its place and folds again, from the keyboard too, without
// the page being left. The member writes the items; the fixture's administrator deletes and
// reads them.

const origin = (page: Page) => new URL(page.url()).origin;

// The fixture's administrator (`bun run dev:fixture`, whichever address serves it) in a browser of
// their own, the same kind of screen as the test's; null where no such account signs in.
async function adminContext(
  browser: Browser,
  page: Page,
): Promise<BrowserContext | null> {
  const context = await browser.newContext({
    ...test.info().project.use,
    baseURL: origin(page),
    storageState: { cookies: [], origins: [] },
  });
  await chooseLanguage(context, origin(page));
  const signIn = await context.request.post("/api/auth/sign-in/username", {
    data: { username: "nova", password: PASSWORD },
    headers: { origin: origin(page) },
  });
  if (!signIn.ok()) {
    await context.close();
    return null;
  }
  return context;
}

// The folded line and its opening, the same for every kind of item.
async function opensInPlace(admin: Page, item: Locator, text: string) {
  const show = item.getByRole("button", { name: "Show…" });
  await expect(item).toContainText("Deleted by nova");
  await expect(item).toContainText("Reason: Off topic");
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await expect(item.getByText(text)).toHaveCount(0);
  await expect(item.getByRole("button", { name: "Restore" })).toBeVisible();
  await expect(
    item.getByRole("button", { name: "Delete permanently" }),
  ).toBeVisible();
  await expectFits(admin, "a folded deleted item");

  const address = admin.url();
  await show.click();
  const hide = item.getByRole("button", { name: "Hide" });
  await expect(item.getByText(text)).toBeVisible();
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await expect(hide).toBeFocused();
  await expectFits(admin, "an opened deleted item");

  // Folded again from the keyboard; the focus stays on the toggle.
  await admin.keyboard.press("Enter");
  await expect(item.getByText(text)).toHaveCount(0);
  await expect(show).toBeFocused();
  expect(admin.url()).toBe(address);

  // Deleting for good asks in the delete dialog over the page, not in a form beside the line.
  const hard = item.getByRole("button", { name: "Delete permanently" });
  await hard.click();
  const dialog = admin.getByRole("dialog", { name: "Delete permanently" });
  await expect(
    dialog.getByRole("textbox", { name: "Reason (optional)" }),
  ).toBeFocused();
  await expectFits(admin, "the permanent delete dialog");
  await admin.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(hard).toBeFocused();
}

test("a deleted reply is one line for the staff, opened and folded in place", async ({
  page,
  browser,
}) => {
  const { threadId } = seed();
  await page.goto("/cookies");
  const headers = { origin: origin(page) };
  const words = unique("Words that were deleted");
  const reply = await page.request.post(`/api/v1/threads/${threadId}/posts`, {
    data: { body: words },
    headers,
  });
  expect(reply.ok(), "the reply is posted").toBe(true);
  const { id, position } = (await reply.json()) as {
    id: number;
    position: number;
  };
  const context = await adminContext(browser, page);
  test.skip(!context, "needs the local fixture's administrator");
  if (!context) return;
  try {
    const deleted = await context.request.delete(`/api/v1/posts/${id}`, {
      data: { reason: "Off topic" },
      headers,
    });
    expect(deleted.ok(), "the reply is deleted").toBe(true);
    const admin = await context.newPage();
    await visit(admin, `/posts/${id}`);
    await rejectCookies(admin);
    const item = admin.locator(`#post-${id}`);
    await expect(item).toContainText(`#${position + 1}`);
    await opensInPlace(admin, item, words);
  } finally {
    await context.close();
  }
});

test("a deleted wall post is one line for the staff, its comments folded with it", async ({
  page,
  browser,
}) => {
  const { memberId } = seed().landing;
  await page.goto("/cookies");
  const headers = { origin: origin(page) };
  const words = unique("A wall post that was deleted");
  const made = await page.request.post(
    `/api/v1/users/${memberId}/profile-posts`,
    { data: { body: words }, headers },
  );
  expect(made.ok(), "the wall post is posted").toBe(true);
  const { id } = (await made.json()) as { id: number };
  const context = await adminContext(browser, page);
  test.skip(!context, "needs the local fixture's administrator");
  if (!context) return;
  try {
    const deleted = await context.request.delete(
      `/api/v1/profile-posts/${id}`,
      { data: { reason: "Off topic" }, headers },
    );
    expect(deleted.ok(), "the wall post is deleted").toBe(true);
    const admin = await context.newPage();
    await visit(admin, `/members/${memberId}`);
    await rejectCookies(admin);
    await opensInPlace(admin, admin.locator(`#profile-post-${id}`), words);
  } finally {
    await context.close();
  }
});
