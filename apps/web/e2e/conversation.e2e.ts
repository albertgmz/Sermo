import type { Page } from "@playwright/test";
import {
  editorReady,
  expect,
  expectFits,
  MEMBER_STATE,
  PEER,
  ready,
  seed,
  test,
  unique,
  visit,
} from "./fixtures";

test.use({ storageState: MEMBER_STATE });

test("a conversation is started with another member and a message is sent in it", async ({
  page,
}) => {
  await visit(page, "/conversations");
  await expect(
    page.getByRole("heading", { name: "Direct messages", level: 1 }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Send direct message" }).click();
  await expect(page).toHaveURL(/\/conversations\/new/);
  await ready(page);

  await page.getByRole("searchbox", { name: "Recipients" }).fill(PEER);
  await page
    .getByRole("group", { name: "Recipients" })
    .getByRole("button", { name: PEER, exact: true })
    .click();
  const title = unique("Chat from the phone");
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page
    .getByRole("textbox", { name: /^Write your message/ })
    .fill("Hello from a phone.");
  await expectFits(page, "new conversation");
  await page.getByRole("button", { name: "Send direct message" }).click();

  await expect(page).toHaveURL(/\/conversations\/\d+/);
  await expect(
    page.getByRole("heading", { name: title, level: 1 }),
  ).toBeVisible();
  await ready(page);
  await expectFits(page, "conversation");

  const message = unique("Second message");
  const writer = page.getByRole("textbox", { name: "Write a message…" });
  await writer.click();
  await editorReady(page);
  await writer.pressSequentially(message);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: message }),
  ).toHaveCount(1);
  await expectFits(page, "after sending");

  await page.goto("/conversations");
  await ready(page);
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await expectFits(page, "conversation list");
});

test("the @ list offers members in a conversation's reply and in a new conversation", async ({
  page,
}) => {
  const mention = `@${PEER.slice(0, 2)}`;
  const offered = page
    .getByRole("listbox", { name: "Members" })
    .getByRole("option", { name: new RegExp(PEER) });

  await visit(page, `/conversations/${seed().landing.conversation.id}`);
  const writer = page.getByRole("textbox", { name: "Write a message…" });
  await writer.click();
  await editorReady(page);
  await page.keyboard.type(mention);
  await expect(offered).toBeVisible();

  await visit(page, "/conversations/new");
  const body = page.getByRole("textbox", { name: /^Write your message/ });
  await body.click();
  await editorReady(page);
  await page.keyboard.type(mention);
  await expect(offered).toBeVisible();
});

// A conversation with the other member, written for the test: its messages read and act as a
// thread's posts (quote, quote a selection, edit in place).
async function ownConversation(page: Page, bodies: string[]) {
  await page.goto("/cookies");
  const headers = { origin: new URL(page.url()).origin };
  const landing = await page.request.get(
    `/api/v1/conversations/${seed().landing.conversation.id}`,
  );
  const { participants } = (await landing.json()) as {
    participants: { user: { id: number } }[];
  };
  const peerId = participants
    .map(({ user }) => user.id)
    .find((id) => id !== seed().landing.memberId);
  const [first, ...rest] = bodies;
  const made = await page.request.post("/api/v1/conversations", {
    data: { title: unique("Unified"), recipientIds: [peerId], body: first },
    headers,
  });
  expect(made.ok(), "the conversation is started").toBe(true);
  const opened = (await made.json()) as {
    conversation: { id: number };
    message: { id: number };
  };
  const ids = [opened.message.id];
  for (const body of rest) {
    const sent = await page.request.post(
      `/api/v1/conversations/${opened.conversation.id}/messages`,
      { data: { body }, headers },
    );
    expect(sent.ok(), "the message is sent").toBe(true);
    ids.push(((await sent.json()) as { id: number }).id);
  }
  return { conversationId: opened.conversation.id, messageIds: ids };
}

const messageBox = (page: Page) =>
  page
    .getByRole("region", { name: "Reply" })
    .getByRole("textbox", { name: "Write a message…" });

test("a message is quoted whole by + Quote and in part by a selection, into the reply editor, as a thread post is", async ({
  page,
}) => {
  const { conversationId } = await ownConversation(page, [
    "Opening line of the chat.",
    "Second message with words to quote.",
  ]);
  await visit(page, `/conversations/${conversationId}`);
  const second = page
    .getByRole("article")
    .filter({ hasText: "Second message with words to quote." });
  // The footer of a thread post: + Quote and Reply, and no Share.
  await expect(second.getByRole("button", { name: "Share" })).toHaveCount(0);
  await second.getByRole("button", { name: "Quote" }).click();
  await editorReady(page.getByRole("region", { name: "Reply" }));
  await expect(messageBox(page).locator("blockquote cite")).toHaveCount(1);
  await expect(messageBox(page).locator("blockquote")).toContainText(
    "Second message with words to quote.",
  );

  await second
    .locator("p", { hasText: "words to quote" })
    .evaluate((paragraph) => {
      paragraph.scrollIntoView({ block: "center" });
      const text = paragraph.firstChild;
      if (!text?.textContent) throw new Error("no text to select");
      const at = text.textContent.indexOf("words to quote");
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + "words to quote".length);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    });
  const offered = page.locator("[data-selection-quote]");
  await expect(offered).toBeVisible();
  await offered.click();
  const quotes = messageBox(page).locator("blockquote");
  await expect(quotes).toHaveCount(2);
  await expect(quotes.nth(1)).toContainText("words to quote");
  await expect(quotes.nth(1)).not.toContainText("Second message");
  await expectFits(page, "conversation quotes");
});

test("a message is edited where it is read, as a thread post: Cancel puts it back, Save draws it anew, the page is never left", async ({
  page,
}) => {
  const {
    conversationId,
    messageIds: [, replyId],
  } = await ownConversation(page, ["Opening line.", "Words to change."]);
  await visit(page, `/conversations/${conversationId}`);
  const address = page.url();
  await page.evaluate(() => {
    (window as unknown as { stillHere: boolean }).stillHere = true;
  });
  const message = page.locator(`#message-${replyId}`);
  const edit = message.getByRole("link", { name: "Edit" });
  const editor = message.getByRole("form", { name: "Editing the post" });

  await edit.click();
  await editorReady(editor);
  await expect(editor.locator('[contenteditable="true"]')).toContainText(
    "Words to change.",
  );
  await expect(
    editor.getByRole("link", { name: "More options…" }),
  ).toHaveAttribute("href", `/conversations/${conversationId}/edit/${replyId}`);
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toHaveCount(0);
  await expect(edit).toBeFocused();

  await edit.click();
  await editorReady(editor);
  const text = editor.locator('[contenteditable="true"]');
  await text.click();
  await text.press("ControlOrMeta+A");
  await text.pressSequentially("Changed in place.");
  await expectFits(page, "message editor");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveCount(0);
  await expect(message).toContainText("Changed in place.");
  await expect(message).not.toContainText("Words to change.");
  await expect(edit).toBeFocused();
  expect(page.url()).toBe(address);
  expect(
    await page.evaluate(
      () => (window as unknown as { stillHere?: boolean }).stillHere === true,
    ),
  ).toBe(true);

  await visit(page, `/conversations/${conversationId}`);
  await expect(page.locator(`#message-${replyId}`)).toContainText(
    "Changed in place.",
  );
});
