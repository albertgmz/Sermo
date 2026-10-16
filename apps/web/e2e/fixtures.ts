import { readFileSync } from "node:fs";
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { PASSWORD, USER } from "./target";

export { PASSWORD, PEER, USER } from "./target";

export const MEMBER_STATE = "test-results/.state/member.json";
export const SEED_FILE = "test-results/.state/seed.json";

// What the setup made: a long thread by the member, a thread by another member (reactions and the
// member card need content that is not the member's own), and a forum the member may post in.
export type Seed = {
  threadId: number;
  peerThreadId: number;
  forumId: number;
};

export const seed = (): Seed => JSON.parse(readFileSync(SEED_FILE, "utf8"));

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

// The page has been hydrated: every control of the page (outside what a library or the stored
// post text draws) has been taken over by React. A press before this reaches a button that has no
// handler yet, or races the hydration of a popup that opens on the first press. A page that does
// not get there fails the test.
export async function ready(page: Page) {
  await page.waitForFunction(
    () => {
      const hydrated = (element: Element) =>
        Object.keys(element).some((key) => key.startsWith("__reactFiber$"));
      const foreign = "#cc-main, nextjs-portal, .bb-content, [data-embed-src]";
      const controls = [
        ...document.querySelectorAll(
          "button, a[href], input:not([type=hidden]), textarea, select",
        ),
      ].filter((element) => !element.closest(foreign));
      return controls.length > 0 && controls.every(hydrated);
    },
    undefined,
    { timeout: 30_000 },
  );
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

// Asks the sign-in limiter (three tries in ten seconds, per address and path) where it stands, with
// a try that cannot succeed: 429 means it is closed.
async function limiterClosed(page: Page) {
  const probe = await page.request.post("/api/auth/sign-in/username", {
    data: { username: USER, password: "not the password" },
    headers: { origin: new URL(page.url()).origin },
  });
  return probe.status() === 429;
}

// Fills the sign-in form and sends it. The page either leaves the form or shows the form's own
// message. When the limiter refuses, its state is polled until it opens (the answer names its own
// wait in x-retry-after) and the form is sent again; a form that has been sent is emptied, so it
// is filled again. After three tries the test ends with the form's message.
export async function signInWith(
  page: Page,
  how: "button" | "enter" = "button",
) {
  let message = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page
      .getByRole("textbox", { name: "Your name or email address:" })
      .fill(USER);
    const password = page.getByRole("textbox", { name: "Password:" });
    await password.fill(PASSWORD);
    // The form is a server action: its answer says the try is over.
    const answered = page.waitForResponse(
      (response) => response.request().headers()["next-action"] !== undefined,
    );
    if (how === "enter") await password.press("Enter");
    else await page.getByRole("button", { name: "Log in" }).click();
    await answered;
    // A good sign-in leaves the form at once once the action has answered; a refusal stays.
    const left = await page
      .waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 10_000,
      })
      .then(
        () => true,
        () => false,
      );
    if (left) return;
    message = (await page.getByRole("alert").allInnerTexts()).join(" ").trim();
    if (await limiterClosed(page))
      await expect
        .poll(() => limiterClosed(page), {
          intervals: [1_000, 2_000],
          timeout: 30_000,
        })
        .toBe(false);
  }
  throw new Error(`the sign-in form did not let the member in: ${message}`);
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
