import { type APIRequestContext, type Page, request } from "@playwright/test";
import {
  editorReady,
  expect,
  MEMBER_STATE,
  PASSWORD,
  seed,
  test,
  unique,
  visit,
} from "./fixtures";
import { DEFAULT_BASE_URL } from "./target";

test.use({ storageState: MEMBER_STATE });

// The edits made where a thread is read (XenForo's quick edit): a post's text turns into the
// editor in place and back, and the thread's title and prefix change in a dialog, without the
// page being left or drawn again.

const origin = (page: Page) => new URL(page.url()).origin;

// A thread of the member's own with one reply, both written for the test.
async function ownThread(page: Page) {
  const { forumId } = seed();
  await page.goto("/cookies");
  const headers = { origin: origin(page) };
  const made = await page.request.post(`/api/v1/nodes/${forumId}/threads`, {
    data: { title: unique("Quick edit"), body: "Opening words." },
    headers,
  });
  expect(made.ok(), "the thread is posted").toBe(true);
  const { thread } = (await made.json()) as {
    thread: { id: number; title: string };
  };
  const reply = await page.request.post(`/api/v1/threads/${thread.id}/posts`, {
    data: { body: "Words to change." },
    headers,
  });
  expect(reply.ok(), "the reply is posted").toBe(true);
  const { id } = (await reply.json()) as { id: number };
  return { threadId: thread.id, title: thread.title, replyId: id };
}

// A full page load would forget this.
const markPage = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { stillHere: boolean }).stillHere = true;
  });
const pageKept = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { stillHere?: boolean }).stillHere === true,
  );

test("a reply is edited where it is read: Cancel puts it back, Save draws it anew, and the page is never left", async ({
  page,
}) => {
  const { threadId, replyId } = await ownThread(page);
  await visit(page, `/threads/${threadId}`);
  await markPage(page);
  const address = page.url();
  const post = page.locator(`#post-${replyId}`);
  const edit = post.getByRole("link", { name: "Edit" });
  const editor = post.getByRole("form", { name: "Editing the post" });

  await edit.click();
  await editorReady(editor);
  expect(page.url()).toBe(address);
  // The editor has the post's own words, and its own buttons in place of the post's footer.
  await expect(editor.locator('[contenteditable="true"]')).toContainText(
    "Words to change.",
  );
  await expect(edit).toHaveCount(0);
  await expect(
    editor.getByRole("link", { name: "More options…" }),
  ).toHaveAttribute("href", `/threads/${threadId}/edit/${replyId}`);

  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toHaveCount(0);
  await expect(post).toContainText("Words to change.");
  await expect(edit).toBeFocused();

  await edit.click();
  await editorReady(editor);
  const text = editor.locator('[contenteditable="true"]');
  await text.click();
  await text.press("ControlOrMeta+A");
  await text.pressSequentially("Changed in place.");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveCount(0);
  await expect(post).toContainText("Changed in place.");
  await expect(post).not.toContainText("Words to change.");
  await expect(edit).toBeFocused();
  expect(page.url()).toBe(address);
  expect(await pageKept(page)).toBe(true);

  // It was saved.
  await visit(page, `/threads/${threadId}`);
  await expect(page.locator(`#post-${replyId}`)).toContainText(
    "Changed in place.",
  );
});

// An administrator of the local fixture, who adds the prefix the flow chooses.
async function adminSession(page: Page): Promise<APIRequestContext | null> {
  if (new URL(page.url()).origin !== new URL(DEFAULT_BASE_URL).origin)
    return null;
  const admin = await request.newContext({
    baseURL: origin(page),
    extraHTTPHeaders: { origin: origin(page) },
  });
  const signIn = await admin.post("/api/auth/sign-in/username", {
    data: { username: "nova", password: PASSWORD },
  });
  if (!signIn.ok()) {
    await admin.dispose();
    return null;
  }
  return admin;
}

test("the thread's title and prefix change in a dialog, the prefix chosen from the keyboard, and the heading follows in place", async ({
  page,
}) => {
  const { threadId, title } = await ownThread(page);
  const admin = await adminSession(page);
  test.skip(!admin, "needs the local fixture's administrator to add a prefix");
  if (!admin) return;
  const colours = (await (
    await admin.get("/api/v1/appearance/colors?kind=prefix")
  ).json()) as { items: { id: number }[] };
  const label = unique("Solved");
  const made = await admin.post("/api/v1/thread-prefixes", {
    data: { label, colorId: colours.items[0].id, offerInAllForums: true },
  });
  expect(made.ok(), "the prefix is added").toBe(true);
  const prefix = (await made.json()) as { id: number };
  try {
    await visit(page, `/threads/${threadId}`);
    await markPage(page);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(title);

    await page.getByRole("link", { name: "Edit thread" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit thread" });
    const field = dialog.getByRole("textbox", { name: "Title" });
    await expect(field).toHaveValue(title);
    await expect(field).toBeFocused();
    await field.fill(`${title} renamed`);

    // The prefix menu, from the keyboard: "(No prefix)" first, then the coloured labels.
    const button = dialog.getByRole("button", { name: "Prefix: (No prefix)" });
    await button.focus();
    await button.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "Prefix" });
    await expect(menu).toBeVisible();
    const items = menu.getByRole("menuitemradio");
    await expect(items.first()).toHaveAccessibleName("(No prefix)");
    await expect(items.first()).toBeFocused();
    await expect(items.first()).toHaveAttribute("aria-checked", "true");
    const ours = menu.getByRole("menuitemradio", { name: label });
    await expect(ours.locator('[style*="--prefix-color"]')).toBeVisible();
    for (let step = 0; step < 20; step += 1) {
      if (await ours.evaluate((item) => item === document.activeElement)) break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(ours).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(
      dialog.getByRole("button", { name: `Prefix: ${label}` }),
    ).toBeFocused();

    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(heading).toContainText(label);
    await expect(heading).toContainText(`${title} renamed`);
    expect(await pageKept(page)).toBe(true);

    // It was saved.
    await visit(page, `/threads/${threadId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      `${title} renamed`,
    );
  } finally {
    await admin.delete(`/api/v1/thread-prefixes/${prefix.id}`);
    await admin.dispose();
  }
});
