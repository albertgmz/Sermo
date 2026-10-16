import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

export const USER = process.env.E2E_USER ?? "ember";
export const PASSWORD = process.env.E2E_PASSWORD ?? "sermo-dev-password";
// Another member for the conversation flow.
export const PEER = process.env.E2E_PEER ?? "wren";
export const PEER_PASSWORD = process.env.E2E_PEER_PASSWORD ?? PASSWORD;

export const MEMBER_STATE = "test-results/.state/member.json";
export const SEED_FILE = "test-results/.state/seed.json";

// What the setup made: a long thread by the member, a thread by another member (reactions and the
// member card need content that is not the member's own), and a forum the member may post in.
export type Seed = {
  threadId: number | null;
  peerThreadId: number | null;
  forumId: number | null;
};

// Console noise that is not the site's, each with its reason. Never a blanket pattern.
const IGNORED_CONSOLE: RegExp[] = [
  // The development server's error overlay asks for source frames, which WebKit refuses across
  // its own origin rules. Production builds have no overlay.
  /__nextjs_original-stack-frames/,
];
// WebKit words a request that was cancelled (the test reloaded or left the page while it was in
// flight) as "Load failed", also as an uncaught rejection.
const WEBKIT_CANCELLED =
  /Failed to fetch RSC payload .* Load failed|^Load failed$|due to access control checks.?$/;

type Options = {
  // A flow that breaks the network on purpose expects the browser to log failures.
  allowConsoleErrors: boolean;
};

// Every test fails on a console error or an uncaught page error, and hides the development
// server's floating badge, which sits over the bottom bar of a phone.
export const test = base.extend<Options & { monitor: undefined }>({
  allowConsoleErrors: [false, { option: true }],
  monitor: [
    async ({ page, allowConsoleErrors, browserName }, use) => {
      const problems: string[] = [];
      await page.addInitScript(() => {
        const hide = () => {
          const style = document.createElement("style");
          style.textContent = "nextjs-portal{display:none!important}";
          document.documentElement.appendChild(style);
        };
        if (document.documentElement) hide();
        else document.addEventListener("DOMContentLoaded", hide);
      });
      page.on("console", (message) => {
        const text = message.text();
        if (
          message.type() === "error" &&
          !IGNORED_CONSOLE.some((p) => p.test(text)) &&
          !(browserName === "webkit" && WEBKIT_CANCELLED.test(text))
        )
          problems.push(`console: ${text.slice(0, 400)}`);
      });
      page.on("pageerror", (error) => {
        if (
          !IGNORED_CONSOLE.some((p) => p.test(error.message)) &&
          !(browserName === "webkit" && WEBKIT_CANCELLED.test(error.message))
        )
          problems.push(`page error: ${error.message.slice(0, 400)}`);
      });
      await use(undefined);
      if (!allowConsoleErrors) expect(problems, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// The size of the screen.
export function screen(page: Page) {
  const size = page.viewportSize();
  if (!size) throw new Error("the page has no viewport");
  return size;
}

export const phoneWidth = (page: Page) =>
  (page.viewportSize()?.width ?? 0) < 768;

// The page has been hydrated: the network is quiet. A press before this reaches a button that has
// no handler yet (or races the hydration of a popup that opens on the first press).
export async function ready(page: Page) {
  await page
    .waitForLoadState("networkidle", { timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(800);
}

// The width the pages are designed for. A narrower phone (an iPhone SE is 320) is tested too.
const DESIGN_WIDTH = 360;

// No horizontal page scroll. The message names the elements that stick out. On a screen narrower
// than the design width the overflow is recorded as an annotation of the test (it shows in the
// report) and does not fail it: the design does not promise anything below 360 px.
export async function expectFits(page: Page, label = page.url()) {
  const found = await page.evaluate(() => {
    const width = window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .map((el) => ({
        text: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`,
      }));
    return { width, scrollWidth, offenders };
  });
  if (found.scrollWidth <= found.width) return;
  const names = found.offenders.slice(0, 6).map((offender) => offender.text);
  if (found.width < DESIGN_WIDTH) {
    test.info().annotations.push({
      type: "found",
      description: `wider than a ${found.width} px screen at ${label}: ${found.scrollWidth} px (${names.join(" | ")})`,
    });
    return;
  }
  expect(
    found.scrollWidth,
    `horizontal scroll at ${label} (${names.join(" | ")})`,
  ).toBeLessThanOrEqual(found.width);
}

export async function visit(page: Page, path: string) {
  await page.goto(path);
  await ready(page);
  await expectFits(page, path);
}

// The cookie banner is answered once per browser context; it shows after the page is drawn. The
// button is found by the library's own role marker, so any language works.
export async function rejectCookies(page: Page) {
  const reject = page.locator('#cc-main .cm__btn[data-role="necessary"]');
  await reject.click();
  await expect(reject).toBeHidden();
}

// Fills the sign-in form and sends it until the page leaves it. The server allows three sign-ins
// in ten seconds, so a refusal for that is waited out and the form sent again (a form that has
// been sent is emptied, so it is filled again).
export async function signInWith(
  page: Page,
  how: "button" | "enter" = "button",
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page
      .getByRole("textbox", { name: "Your name or email address:" })
      .fill(USER);
    const password = page.getByRole("textbox", { name: "Password:" });
    await password.fill(PASSWORD);
    if (how === "enter") await password.press("Enter");
    else await page.getByRole("button", { name: "Log in" }).click();
    const left = await page
      .waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 15_000,
      })
      .then(
        () => true,
        () => false,
      );
    if (left) return;
    await page.waitForTimeout(11_000);
  }
  throw new Error("the sign-in form did not let the member in");
}

// The button that opens the Create dialog: the bottom bar's on a phone, the header's on a tablet.
export const createButton = (page: Page) =>
  page.getByRole("button", { name: "Create", exact: true }).first();

// A box of the page in CSS pixels.
export async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("the element has no box");
  return rect;
}

// The lazily loaded editor is in: its formatting bar is drawn.
export async function editorReady(scope: Page | Locator) {
  await expect(
    scope.getByRole("toolbar", { name: "Formatting" }),
  ).toBeVisible();
}

export const unique = (prefix: string) =>
  `${prefix} ${Date.now().toString(36)}`;
