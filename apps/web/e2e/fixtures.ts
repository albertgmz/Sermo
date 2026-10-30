import { readFileSync } from "node:fs";
import {
  test as base,
  expect,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { PASSWORD, USER } from "./target";

export { PASSWORD, PEER, USER } from "./target";

export const MEMBER_STATE = "test-results/.state/member.json";
export const SEED_FILE = "test-results/.state/seed.json";

// What the setup made: a long thread by the member, a thread by another member (reactions and the
// member card need content that is not the member's own), a forum the member may post in, what
// the landing flows aim at, and a thread of six pages (the pager's "go to page" shows from there).
export type Seed = {
  threadId: number;
  pagerThreadId: number;
  peerThreadId: number;
  forumId: number;
  landing: LandingSeed;
};

// What the landing flows aim at (see `setup.e2e.ts`): items deep in long lists, each below a few
// tall pictures, and the alerts another member's reactions to them gave the member.
export type LandingSeed = {
  memberId: number;
  // The last post of the long thread (on its third page), with a word nothing else holds.
  post: { id: number; position: number };
  word: string;
  // The member's own wall: its oldest post (off the first page, with the long run of comments),
  // its newest, and a comment older than the three the wall shows.
  wall: {
    oldestPostId: number;
    newestPostId: number;
    commentId: number;
    posts: number;
    comments: number;
  };
  // A conversation with the other member, and a message on its oldest page.
  conversation: { id: number; messageId: number; messages: number };
  // The items whose reaction gave the member an alert, as `type:id`.
  alerted: string[];
};

// Pictures in seeded posts are linked from this host, which does not exist: every test serves
// them (see `test`), and the landing flows serve them late.
export const PICTURE_HOST = "https://pictures.e2e.invalid";
export const TALL_PICTURE = `${PICTURE_HOST}/tall.svg`;
const TALL_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#888"/></svg>';
export const servePicture = (route: Route) =>
  route.fulfill({ contentType: "image/svg+xml", body: TALL_SVG });

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
  /Failed to fetch RSC payload .* Load failed|^(TypeError: )?Load failed$|due to access control checks.?$/;

type Options = {
  // A flow that breaks the network on purpose expects the browser to log failures.
  allowConsoleErrors: boolean;
  // The language the visitor chose with the language switch (the `forum_locale` cookie). The site
  // is Spanish unless the cookie says English, so a test reads English by default; a test of the
  // Spanish pages sets `test.use({ language: "es" })`.
  language: "en" | "es";
};

// Every test fails on a console error or an uncaught page error, serves the seeded pictures, and
// hides the development server's floating badge, which sits over the bottom bar of a phone.
export const test = base.extend<Options & { monitor: undefined }>({
  allowConsoleErrors: [false, { option: true }],
  language: ["en", { option: true }],
  context: async ({ context, baseURL, language }, use) => {
    await context.addCookies([
      { name: "forum_locale", value: language, url: baseURL ?? "" },
    ]);
    await use(context);
  },
  monitor: [
    async ({ page, allowConsoleErrors, browserName }, use) => {
      const problems: string[] = [];
      // The large seed's attachments are rows of a fake storage driver with no bytes behind them:
      // the backend answers their address with 400 "Storage driver is unavailable" and the browser
      // logs one line per picture, without the address. Each such answer is matched to one line;
      // any other 400 still fails the test.
      let fakeFileAnswers = 0;
      const answerChecks: Promise<void>[] = [];
      const loadFailures: string[] = [];
      await page.context().route(`${PICTURE_HOST}/**`, servePicture);
      await page.addInitScript(() => {
        const hide = () => {
          const style = document.createElement("style");
          style.textContent = "nextjs-portal{display:none!important}";
          document.documentElement.appendChild(style);
        };
        if (document.documentElement) hide();
        else document.addEventListener("DOMContentLoaded", hide);
      });
      page.on("response", (response) => {
        if (
          response.status() !== 400 ||
          !/^\/api\/v1\/files\/\d+$/.test(new URL(response.url()).pathname)
        )
          return;
        answerChecks.push(
          response.text().then(
            (body) => {
              if (body.includes("Storage driver is unavailable"))
                fakeFileAnswers += 1;
            },
            () => {},
          ),
        );
      });
      page.on("console", (message) => {
        const text = message.text();
        if (
          message.type() === "error" &&
          /^Failed to load resource: .* status of 400/.test(text)
        ) {
          loadFailures.push(`console: ${text.slice(0, 400)}`);
          return;
        }
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
      await Promise.all(answerChecks);
      problems.push(...loadFailures.slice(fakeFileAnswers));
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

// Nothing in the header is cut off by the screen's edge, and nothing wraps to a second line. Below
// the design width the overflow is reported by expectFits, not failed here.
export async function expectHeaderOnScreen(page: Page) {
  const header = page.getByRole("banner");
  const size = screen(page);
  const shown = header.locator("a:visible, button:visible");
  const count = size.width < DESIGN_WIDTH ? 0 : await shown.count();
  for (let index = 0; index < count; index += 1) {
    const frame = await box(shown.nth(index));
    expect(
      frame.x,
      `header item ${index} starts on the screen`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      frame.x + frame.width,
      `header item ${index} ends on the screen`,
    ).toBeLessThanOrEqual(size.width);
  }
  const height = await header.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(height).toBeLessThanOrEqual(80);
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

// A name nobody has, valid as a username and new at every call: the wrong passwords are counted per
// name and address (ten in fifteen minutes, whether or not the account exists), so a name that
// every test and probe used again would be refused for them.
export const nobody = () => `nf${Math.random().toString(36).slice(2, 10)}`;

// Asks the sign-in limiter (a few tries in ten seconds, per address and path) where it stands, with
// a try that cannot succeed, under a fresh name nobody has so no wrong-password count is shared or
// spent. Returns the seconds the answer says to wait (429 and x-retry-after), or 0 when it is open.
export async function limiterWait(page: Page) {
  const probe = await page.request.post("/api/auth/sign-in/username", {
    data: { username: nobody(), password: "not the password" },
    headers: { origin: new URL(page.url()).origin },
  });
  if (probe.status() !== 429) return 0;
  return Number(probe.headers()["x-retry-after"]) || 1;
}

// Fills the sign-in form and sends it. The page either leaves the form or shows the form's own
// message. When the limiter refuses, the wait it names (x-retry-after) is waited out and the form
// is sent again; a form that has been sent is emptied, so it is filled again. After three tries the
// test ends with the form's message.
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
        timeout: 15_000,
      })
      .then(
        () => true,
        () => false,
      );
    if (left) return;
    message = (await page.getByRole("alert").allInnerTexts()).join(" ").trim();
    // Nothing is sent while it waits: a probe that lands as the window ends is refused and starts
    // the window again, so probing every second keeps the limiter closed for good.
    const wait = await limiterWait(page);
    if (wait > 0) await page.waitForTimeout((wait + 2) * 1_000);
  }
  throw new Error(`the sign-in form did not let the member in: ${message}`);
}

// The button that opens the Create dialog: the bottom bar's round + (a phone only; from 768 px up the
// forum's own New thread button starts a thread).
export const createButton = (page: Page) =>
  page.getByRole("button", { name: "Create", exact: true }).first();

// A box of the page in CSS pixels.
export async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("the element has no box");
  return rect;
}

// The lazily loaded editor is in: its text is drawn (its formatting bar is drawn before it comes),
// and it has taken in what was just done to it. The editor now loads once the page is idle, so a
// press made right before may land in its text rather than in the box it replaced: the browser
// reports the caret that press placed a moment later, and the editor, taking it in, puts the focus
// back in its text (Lexical does). Two frames let that happen before the test moves the focus.
export async function editorReady(scope: Page | Locator) {
  await expect(
    scope.getByRole("toolbar", { name: "Formatting" }),
  ).toBeVisible();
  await expect(scope.locator('[contenteditable="true"]').first()).toBeVisible();
  const page = "goto" in scope ? scope : scope.page();
  await page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done)),
      ),
  );
}

export const unique = (prefix: string) =>
  `${prefix} ${Date.now().toString(36)}`;
