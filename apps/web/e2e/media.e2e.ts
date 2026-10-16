import {
  createButton,
  expect,
  expectFits,
  MEMBER_STATE,
  ready,
  screen,
  test,
  unique,
  visit,
} from "./fixtures";

test.use({ storageState: MEMBER_STATE });

type Page = import("@playwright/test").Page;

// A 400 x 300 red picture.
const PICTURE = Buffer.from(
  "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",
  "base64",
);

async function postPicture(page: Page) {
  await visit(page, "/");
  await createButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Create" });
  await dialog.getByRole("button", { name: /^Wall post/ }).click();
  const box = dialog.getByRole("textbox", { name: "What's on your mind?" });
  await box.click();
  await box.pressSequentially(unique("Picture from the phone"));
  await dialog.locator("input[type=file]").first().setInputFiles({
    name: "phone.png",
    mimeType: "image/png",
    buffer: PICTURE,
  });
  await expect(dialog.getByText("phone.png")).toBeVisible();
  await dialog.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page).toHaveURL(/\/members\/\d+/);
}

test("the media tab viewer opens, Esc closes it, and the Back button closes it", async ({
  page,
}) => {
  await postPicture(page);
  await visit(page, "/?tab=media");
  const card = page.getByRole("main").locator("li a").first();
  await expect(card).toBeVisible();
  await expectFits(page, "media tab");
  await card.click();

  const viewer = page.getByRole("dialog", { name: "Picture viewer" });
  await expect(viewer).toBeVisible();
  await expect(page).toHaveURL(/picture=/);
  const size = screen(page);
  const picture = await viewer.getByRole("img").first().boundingBox();
  if (!picture) throw new Error("the picture has no box");
  expect(picture.x + picture.width).toBeLessThanOrEqual(size.width + 1);
  await expectFits(page, "viewer");

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(page).not.toHaveURL(/picture=/);

  await card.click();
  await expect(viewer).toBeVisible();
  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(page).not.toHaveURL(/picture=/);

  // A pasted viewer address opens the viewer, and a reload keeps it.
  await card.click();
  await expect(viewer).toBeVisible();
  const address = page.url();
  await page.goto(address);
  await ready(page);
  await expect(viewer).toBeVisible();
  await page.reload();
  await ready(page);
  await expect(viewer).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toBeHidden();
});

test("with the data saver on the media tab loads no picture", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "forum_lite", value: "all", url: baseURL ?? "" },
  ]);
  const pictures: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/files/")) pictures.push(request.url());
  });
  await visit(page, "/?tab=media");
  await expect(page.getByRole("main").locator("li").first()).toBeVisible();
  expect(pictures, "picture requests with the data saver on").toEqual([]);
  expect(await page.locator("main img").count()).toBe(0);
  await expectFits(page, "media tab with the data saver");
});
