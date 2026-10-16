import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, MEMBER_STATE, PASSWORD, ready, test, USER } from "./fixtures";

// A form can be sent before the page's script has taken the page over: a quick press, a slow
// phone. The browser then posts the form itself. These tests keep the scripts of the page from
// loading (the inline scripts that draw the streamed page still run), so every form is sent that
// way, and ask that the page they land on is a real one. The blocked scripts are reported as failed
// loads, which is what the console check of the fixtures is for in the other tests.
test.use({ allowConsoleErrors: true });

const RATE_LIMITED = /Too many attempts/;

async function withoutScripts(page: Page) {
  await page
    .context()
    .route("**/_next/static/chunks/*.js", (route) => route.abort());
}

// Fills the sign-in form and presses Enter. The limiter may refuse a try made seconds after
// another sign-in of the suite: its refusal is a page of the form too, and the wait it asks for is
// waited out before the form is sent again.
async function sendSignIn(page: Page, password: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/login");
    await page
      .getByRole("textbox", { name: "Your name or email address:" })
      .fill(USER);
    const field = page.getByRole("textbox", { name: "Password:" });
    await field.fill(password);
    await Promise.all([page.waitForNavigation(), field.press("Enter")]);
    const refused = page.getByRole("alert").filter({ hasText: RATE_LIMITED });
    if ((await refused.count()) === 0) return;
    await expect(
      page.getByRole("textbox", { name: "Your name or email address:" }),
    ).toBeVisible();
    await page.waitForTimeout(12_000);
  }
}

test("a sign-in sent before the page's script loaded lands signed in on a real page @all", async ({
  page,
  context,
}) => {
  // The account has a saved cookie choice, as in the test that adopts it: a sign-in that adopts it
  // is the one that answered with a state nothing could draw.
  await context.addCookies(
    JSON.parse(readFileSync(MEMBER_STATE, "utf8")).cookies,
  );
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Cookie settings" }).click();
  const saved = page.waitForResponse(
    (response) => response.request().headers()["next-action"] !== undefined,
  );
  await page
    .getByRole("dialog", { name: "Cookie settings" })
    .getByRole("button", { name: "Accept all" })
    .click();
  await saved;
  await context.clearCookies();

  await withoutScripts(page);
  await sendSignIn(page, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText("does not exist or has moved")).toHaveCount(0);
  const cookies = await context.cookies();
  expect(cookies.map((cookie) => cookie.name)).toContain("sermo.session_token");
  // The choice the account holds was adopted: the banner does not ask again.
  expect(cookies.map((cookie) => cookie.name)).toContain("forum_consent");
});

test("a refused sign-in sent before the page's script loaded shows its message on the form @all", async ({
  page,
}) => {
  await withoutScripts(page);
  await sendSignIn(page, "not the password");
  await expect(page).toHaveURL(/\/login\?refused=invalidCredentials/);
  await expect(page.getByRole("alert")).toHaveText(
    "Wrong username or password.",
  );
  await expect(
    page.getByRole("textbox", { name: "Your name or email address:" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password:" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});
