import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import {
  expect,
  limiterWait,
  MEMBER_STATE,
  nobody,
  PASSWORD,
  ready,
  test,
  USER,
} from "./fixtures";

// A form can be sent before the page's script has taken the page over: a quick press, a slow
// phone. The browser then posts the form itself. These tests keep the scripts of the page from
// loading (the inline scripts that draw the streamed page still run), so every form is sent that
// way, and ask that the page they land on is a real one. The blocked scripts are reported as failed
// loads, which is what the console check of the fixtures is for in the other tests.
test.use({ allowConsoleErrors: true });
// A service worker would answer the scripts from its cache, past the block: the page would then
// hydrate and the form would not be sent by the browser at all.
test.use({ serviceWorkers: "block" });

const RATE_LIMITED = /Too many attempts/;
const NAME = "Your name or email address:";

async function withoutScripts(page: Page) {
  await page
    .context()
    .route("**/_next/static/chunks/*.js", (route) => route.abort());
}

// Sends the sign-in form the way the browser does without the page's script: fill, Enter, and the
// page that comes back.
async function sendOnce(page: Page, name: string, password: string) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: NAME }).fill(name);
  const field = page.getByRole("textbox", { name: "Password:" });
  await field.fill(password);
  // The page is not hydrated: React would send the form itself, and the test would pass without
  // the path it is for.
  expect(
    await field.evaluate((element) =>
      Object.keys(element).some((key) => key.startsWith("__reactFiber$")),
    ),
  ).toBe(false);
  await Promise.all([
    page.waitForNavigation({ timeout: 15_000 }),
    field.press("Enter"),
  ]);
}

// Sends it, and when the limiter refuses the way the sign-in fixture handles it: the refusal is a
// page of the form, nothing is sent while the wait the limiter names (x-retry-after, asked with a
// try that cannot succeed under a name nobody has) runs out, and the form is sent again. A refusal
// the limiter does not name a wait for is the account's own wrong-password budget, which no wait
// of a test gives back: the test ends with it.
async function sendSignIn(page: Page, name: string, password: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await sendOnce(page, name, password);
    const refused = page.getByRole("alert").filter({ hasText: RATE_LIMITED });
    if ((await refused.count()) === 0) return;
    const wait = await limiterWait(page);
    if (wait === 0)
      throw new Error(
        "the sign-in was refused for the account's wrong passwords, not for its pace",
      );
    await page.waitForTimeout((wait + 2) * 1_000);
  }
  throw new Error("the limiter refused three sign-ins in a row");
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
  await sendSignIn(page, USER, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Forums" })).toBeVisible();
  await expect(page.getByText("does not exist or has moved")).toHaveCount(0);
  const cookies = await context.cookies();
  expect(cookies.map((cookie) => cookie.name)).toContain("sermo.session_token");
  // The choice the account holds was adopted: the banner does not ask again.
  expect(cookies.map((cookie) => cookie.name)).toContain("forum_consent");
});

// Under a name nobody has: a wrong password for the member would spend the account's wrong
// passwords (ten in fifteen minutes from this address), which the sign-in tests of the suite need.
test("a refused sign-in sent before the page's script loaded shows its message on the form @all", async ({
  page,
}) => {
  await withoutScripts(page);
  await sendSignIn(page, nobody(), "not the password");
  await expect(page).toHaveURL(/\/login\?refused=invalidCredentials/);
  await expect(page.getByRole("alert")).toHaveText(
    "Wrong username or password.",
  );
  await expect(page.getByRole("textbox", { name: NAME })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Password:" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("the limiter's refusal of a sign-in sent before the page's script loaded shows its message on the form @all", async ({
  page,
}) => {
  await withoutScripts(page);
  // Better Auth lets a few sign-in tries through per ten seconds from an address; the next is
  // refused. Every try is under a name nobody has.
  const name = nobody();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await sendOnce(page, name, "not the password");
    if (new URL(page.url()).search.includes("rateLimited")) break;
  }
  await expect(page).toHaveURL(/\/login\?refused=rateLimited/);
  await expect(page.getByRole("alert")).toHaveText(RATE_LIMITED);
  await expect(page.getByRole("textbox", { name: NAME })).toBeVisible();
  // Leave the limiter open for the tests that follow: nothing is sent until its wait is over.
  for (let wait = await limiterWait(page); wait > 0; ) {
    await page.waitForTimeout((wait + 2) * 1_000);
    wait = await limiterWait(page);
  }
});
