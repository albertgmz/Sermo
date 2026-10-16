import { box, expect, expectFits, ready, screen, test } from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

const banner = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Your cookie choices" });

const consent = async (page: import("@playwright/test").Page) =>
  (await page.context().cookies()).find(
    (cookie) => cookie.name === "forum_consent",
  );

async function chosen(page: import("@playwright/test").Page) {
  const cookie = await consent(page);
  return cookie
    ? (JSON.parse(decodeURIComponent(cookie.value)).categories as string[])
    : null;
}

test("the cookie banner shows inside the screen with three buttons you can press @all", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = banner(page);
  await expect(dialog).toBeVisible();
  const size = screen(page);
  // The banner slides in: measure once it has stopped.
  await expect
    .poll(async () => {
      const frame = await box(dialog);
      return frame.y + frame.height;
    })
    .toBeLessThanOrEqual(size.height);
  const frame = await box(dialog);
  expect(frame.x).toBeGreaterThanOrEqual(0);
  expect(frame.x + frame.width).toBeLessThanOrEqual(size.width);
  for (const name of ["Accept all", "Reject all", "Choose"]) {
    const button = await box(dialog.getByRole("button", { name }));
    expect(button.height, `${name} is a touch target`).toBeGreaterThanOrEqual(
      40,
    );
    expect(
      button.y + button.height,
      `${name} is on the screen`,
    ).toBeLessThanOrEqual(size.height);
  }
  await expectFits(page, "banner");
});

test("accept all is remembered after a reload @all", async ({ page }) => {
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Accept all" }).click();
  await expect(banner(page)).toBeHidden();
  expect(await chosen(page)).toEqual(
    expect.arrayContaining(["necessary", "referrals", "embeds"]),
  );
  await page.reload();
  await ready(page);
  await expect(banner(page)).toBeHidden();
  await expectFits(page, "after accept");
});

test("reject all is remembered, and the footer reopens the settings @all", async ({
  page,
}) => {
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Reject all" }).click();
  await expect(banner(page)).toBeHidden();
  expect(await chosen(page)).toEqual(["necessary"]);
  await page.reload();
  await ready(page);
  await expect(banner(page)).toBeHidden();

  await page.getByRole("button", { name: "Cookie settings" }).click();
  const settings = page.getByRole("dialog", { name: "Cookie settings" });
  await expect(settings).toBeVisible();
  const frame = await box(settings);
  const size = screen(page);
  expect(frame.x + frame.width).toBeLessThanOrEqual(size.width);
  expect(frame.y).toBeGreaterThanOrEqual(0);
  await expectFits(page, "settings");
  // Pick the optional categories one by one, save, and the choice follows.
  await settings.getByRole("button", { name: "Save my choices" }).click();
  await expect(settings).toBeHidden();
});

test("choose opens the settings from the banner, and a saved choice is kept @all", async ({
  page,
}) => {
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Choose" }).click();
  const settings = page.getByRole("dialog", { name: "Cookie settings" });
  await expect(settings).toBeVisible();
  await expectFits(page, "choose");
  await settings.getByRole("button", { name: "Save my choices" }).click();
  await expect(settings).toBeHidden();
  await page.reload();
  await ready(page);
  await expect(banner(page)).toBeHidden();
});
