import {
  expect,
  expectFits,
  PASSWORD,
  ready,
  rejectCookies,
  signInWith,
  test,
  USER,
} from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

const banner = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Your cookie choices" });

async function fillSignIn(
  page: import("@playwright/test").Page,
  password: string,
) {
  await page
    .getByRole("textbox", { name: "Your name or email address:" })
    .fill(USER);
  await page.getByRole("textbox", { name: "Password:" }).fill(password);
}

test("a wrong password is refused with a message, the right one signs in, and Log out signs out @all", async ({
  page,
}) => {
  await page.goto("/login");
  await ready(page);
  await rejectCookies(page);
  await expectFits(page, "login");

  await fillSignIn(page, `${PASSWORD}-wrong`);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Wrong username or password" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await expectFits(page, "login refused");

  await signInWith(page);
  const menu = page.getByRole("button", { name: "Account menu" });
  await expect(menu).toBeVisible();
  await ready(page);
  await expectFits(page, "signed in");

  await menu.click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    page.getByRole("link", { name: "Log in" }).first(),
  ).toBeVisible();
  await expect(menu).toBeHidden();
});

test("the sign-in button can be pressed while the cookie banner is still open @all", async ({
  page,
}) => {
  await page.goto("/login");
  await ready(page);
  await expect(banner(page)).toBeVisible();
  await signInWith(page);
  await expect(
    page.getByRole("button", { name: "Account menu" }),
  ).toBeVisible();
});

test("a member's cookie choice follows the account to a browser that has made none @all", async ({
  page,
  context,
}) => {
  // Signed in with the saved session: accept everything from the footer; it is saved on the
  // account.
  await context.addCookies(
    JSON.parse(
      (await import("node:fs")).readFileSync(
        "test-results/.state/member.json",
        "utf8",
      ),
    ).cookies,
  );
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Cookie settings" }).click();
  const settings = page.getByRole("dialog", { name: "Cookie settings" });
  await settings.getByRole("button", { name: "Accept all" }).click();
  await expect(settings).toBeHidden();
  await page.waitForTimeout(1500);

  // A browser with no cookies: the banner shows, and signing in adopts the account's choice.
  await context.clearCookies();
  await page.goto("/login");
  await ready(page);
  await expect(banner(page)).toBeVisible();
  await signInWith(page, "enter");
  await ready(page);
  await expect(banner(page)).toBeHidden();
  const cookie = (await context.cookies()).find(
    (entry) => entry.name === "forum_consent",
  );
  if (!cookie) throw new Error("the adopted choice is not a cookie again");
  expect(JSON.parse(decodeURIComponent(cookie.value)).categories).toEqual(
    expect.arrayContaining(["embeds", "referrals"]),
  );
});
