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

  await page
    .getByRole("searchbox", { name: "Search members by username" })
    .fill(PEER);
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
