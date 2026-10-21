import type { Page } from "@playwright/test";
import {
  box,
  expect,
  expectFits,
  MEMBER_STATE,
  phoneWidth,
  ready,
  screen,
  test,
} from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

const banner = (page: Page) =>
  page.getByRole("dialog", { name: "A quick word about cookies" });

const consent = async (page: Page) =>
  (await page.context().cookies()).find(
    (cookie) => cookie.name === "forum_consent",
  );

async function chosen(page: Page) {
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
  // Accept and reject weigh the same; accept carries the cookie.
  const accept = dialog.getByRole("button", { name: "Accept all" });
  const reject = await box(dialog.getByRole("button", { name: "Reject all" }));
  expect((await box(accept)).height).toBe(reject.height);
  expect(Math.round((await box(accept)).width)).toBe(Math.round(reject.width));
  await expect(accept.locator("svg")).toHaveCount(1);
  // The usual gutter on each side, and above the bottom bar where there is one.
  // A page wider than the screen widens the layout viewport the banner is centred in, which moves
  // its right edge in: the message names what sticks out of the screen.
  const wide = await page.evaluate((width) => {
    const out = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > width + 0.5)
      .slice(0, 6)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} ${Math.round(el.getBoundingClientRect().right)}`,
      );
    return `inner ${window.innerWidth}, scroll ${document.documentElement.scrollWidth}: ${out.join(" | ")}`;
  }, size.width);
  expect(frame.x, wide).toBeGreaterThanOrEqual(15);
  expect(
    size.width - frame.x - frame.width,
    `the banner's right gutter (${wide})`,
  ).toBeGreaterThanOrEqual(15);
  if (phoneWidth(page)) {
    const bar = await box(page.getByRole("navigation", { name: "Primary" }));
    expect(frame.y + frame.height).toBeLessThanOrEqual(bar.y);
  }
  await expectFits(page, "banner");
});

test.describe("on a desktop screen", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  });

  // The content box of the forum's Container (the header's): its width less the gutters.
  const forum = (page: Page) =>
    page
      .locator('header [data-slot="container"]')
      .first()
      .evaluate((element) => {
        const frame = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const left = Number.parseFloat(style.paddingLeft);
        const right = Number.parseFloat(style.paddingRight);
        return { x: frame.x + left, width: frame.width - left - right };
      });

  test("the banner is exactly as wide as the forum and lines up with it, also when narrow", async ({
    page,
  }) => {
    await page.goto("/");
    const dialog = banner(page);
    await expect(dialog).toBeVisible();
    for (const narrow of [false, true]) {
      if (narrow)
        await page.evaluate(() =>
          document.documentElement.setAttribute("data-width", "narrow"),
        );
      const content = await forum(page);
      expect(content.width).toBe(narrow ? 1068 : 1388);
      await expect
        .poll(async () => Math.round((await box(dialog)).width))
        .toBe(Math.round(content.width));
      expect(Math.round((await box(dialog)).x)).toBe(Math.round(content.x));
    }
  });
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

// The notification card waits for the banner and follows either answer. The member's session comes
// from the setup, which answered the banner and put the cards off: this test asks again for both.
// The card needs a browser that can receive pushes (Chromium; iOS Safari waits for the installed
// app) and a forum with push keys (`SERMO_VAPID_*`).
test.describe("the notification card after the cookie banner", () => {
  test.use({ storageState: MEMBER_STATE });

  const card = (page: Page) =>
    page.getByRole("region", {
      name: "Would you like alerts for replies, mentions and messages?",
    });

  for (const [answer, categories] of [
    ["Accept all", ["necessary", "referrals", "embeds"]],
    ["Reject all", ["necessary"]],
  ] as const) {
    test(`it appears once the banner is answered with ${answer.toLowerCase()} @all`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName === "webkit", "iOS pushes need the installed app");
      const key = await page.request.get("/api/v1/push/public-key");
      expect(key.ok()).toBe(true);
      test.skip(
        ((await key.json()) as { publicKey: string | null }).publicKey === null,
        "this forum has no push keys",
      );
      // The banner is asked again and neither card is put off.
      await page.context().clearCookies({ name: "forum_consent" });
      await page.goto("/cookies");
      await ready(page);
      await page.evaluate(() => localStorage.removeItem("sermo-app-prompts"));
      await page.goto("/");
      await ready(page);
      await expect(banner(page)).toBeVisible();
      // The card is held back for a moment after the answer: wait longer than that with the banner
      // still up, and it has not appeared.
      await page.waitForTimeout(2_500);
      await expect(card(page)).toHaveCount(0);

      await banner(page).getByRole("button", { name: answer }).click();
      await expect(banner(page)).toBeHidden();
      expect(await chosen(page)).toEqual(
        expect.arrayContaining([...categories]),
      );
      await expect(card(page)).toBeVisible();
      await expect(
        card(page).getByRole("button", { name: "Turn on" }),
      ).toBeVisible();
      await expectFits(page, `notification card after ${answer}`);
    });
  }
});
