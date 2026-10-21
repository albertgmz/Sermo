import {
  box,
  editorReady,
  expect,
  expectFits,
  MEMBER_STATE,
  phoneWidth,
  ready,
  rejectCookies,
  screen,
  seed,
  test,
  visit,
} from "./fixtures";

// Browser checks that earlier items could not run: gestures, popups, focus, touch targets and the
// pages' own metadata. Each one names the item it closes.

// The reaction button of a post: the member's own reaction or "Like", with its count.
const REACTION_BUTTON = /^[A-Za-z]+, \d+ reactions?$/;

test.describe("signed in", () => {
  test.use({ storageState: MEMBER_STATE });

  // Items 16 and 16c: five cells in the bottom bar, labels whole, in both languages. A 320 px phone
  // is narrower than the design width: the labels are measured from 360 px.
  test("no label of the bottom bar is cut off @all", async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(!phoneWidth(page), "the bottom bar is for phones");
    test.skip(
      screen(page).width < 360,
      "the bar is designed for 360 px and up",
    );
    for (const language of ["en", "es"]) {
      await context.addCookies([
        { name: "forum_locale", value: language, url: baseURL ?? "" },
      ]);
      await visit(page, "/");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      // Only what draws text is a label. The unread dot of an icon sticks out of the icon's box on
      // purpose, and the screen-reader text is clipped to a pixel: a member with unread alerts (the
      // large forum's) has both.
      const cut = await page.evaluate(() =>
        [...document.querySelectorAll('nav[aria-label="Primary"] *')]
          .filter((element) => !element.closest(".sr-only"))
          .filter((element) => element.textContent?.trim())
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map(
            (element) =>
              `${element.textContent?.trim()} (${element.scrollWidth} in ${element.clientWidth})`,
          ),
      );
      expect(cut, `cropped labels in the bottom bar (${language})`).toEqual([]);
    }
    await context.addCookies([
      { name: "forum_locale", value: "en", url: baseURL ?? "" },
    ]);
  });

  // Item 10c: holding the reaction button opens the picker inside the screen.
  test("holding the Like button opens the reaction picker inside the screen", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "touch events are sent through the Chrome protocol",
    );
    const { peerThreadId } = seed();
    await visit(page, `/threads/${peerThreadId}`);
    const like = page.getByRole("button", { name: REACTION_BUTTON }).first();
    const chosen = ((await like.getAttribute("aria-label")) ?? "").includes(
      "Haha",
    )
      ? "Wow"
      : "Haha";
    // Centred, not just brought into view: a button that is only in view can sit under the fixed
    // bottom bar, which takes the touch.
    await like.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    const spot = await box(like);
    const x = spot.x + spot.width / 2;
    const y = spot.y + spot.height / 2;
    const touch = await context.newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    const picker = page.locator('[data-slot="popover-content"]').first();
    await expect(picker).toBeVisible();
    const frame = await box(picker);
    const size = screen(page);
    expect(frame.x).toBeGreaterThanOrEqual(16 - 1);
    expect(frame.x + frame.width).toBeLessThanOrEqual(size.width - 16 + 1);
    // The popover scales in over 100 ms: a button measured on the way is a hair under its size.
    await picker.evaluate((element) =>
      Promise.all(
        element.getAnimations().map((animation) => animation.finished),
      ),
    );
    const reactions = picker.getByRole("button");
    for (let index = 0; index < (await reactions.count()); index += 1) {
      const target = await box(reactions.nth(index));
      expect(target.width).toBeGreaterThanOrEqual(40);
      expect(target.height).toBeGreaterThanOrEqual(40);
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    // Released on the button: the picker stays open for a tap on a reaction.
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: chosen }).tap();
    await expect(
      page
        .getByRole("button", { name: new RegExp(`^${chosen}, 1 reaction`) })
        .first(),
    ).toBeVisible();
    await expectFits(page, "after reacting");
  });

  test("a short press that slides away opens no picker", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "touch events are sent through the Chrome protocol",
    );
    await page.clock.install();
    const { peerThreadId } = seed();
    await visit(page, `/threads/${peerThreadId}`);
    const like = page.getByRole("button", { name: REACTION_BUTTON }).first();
    // Centred, not just brought into view: a button that is only in view can sit under the fixed
    // bottom bar, which takes the touch.
    await like.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    const spot = await box(like);
    const x = spot.x + spot.width / 2;
    const y = spot.y + spot.height / 2;
    const touch = await context.newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 5; step += 1) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y - step * 20 }],
      });
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    // The picker opens when a hold timer runs out: run the page's clock past it.
    await page.clock.runFor(1_000);
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
  });

  // Item 15: the compact list.
  test("the compact feed list is kept over a reload and every row fits @all", async ({
    page,
  }) => {
    await visit(page, "/");
    // The toggle saves the choice with a server action and then loads the page again. A reload of
    // the test's own before that is done would cancel the save, or collide with the page's reload
    // (the large forum answers slowly), so the test waits until the document it marked is gone.
    const reloadedByPage = async () => {
      await page.waitForFunction(
        () => !document.documentElement.dataset.beforeReload,
        undefined,
        { timeout: 30_000 },
      );
      await ready(page);
    };
    const markDocument = () =>
      page.evaluate(() => {
        document.documentElement.dataset.beforeReload = "1";
      });
    // The choice is kept on the member's account, so a run that stopped half way leaves it on
    // compact, and pressing the button that is already pressed saves nothing and never reloads.
    // Start from cards whatever the last run left.
    if (
      (await page
        .getByRole("button", { name: "Compact list" })
        .getAttribute("aria-pressed")) === "true"
    ) {
      await markDocument();
      await page.getByRole("button", { name: "Cards" }).click();
      await reloadedByPage();
    }
    await markDocument();
    await page.getByRole("button", { name: "Compact list" }).click();
    await expect(
      page.getByRole("button", { name: "Compact list" }),
    ).toHaveAttribute("aria-pressed", "true");
    await reloadedByPage();
    await page.reload();
    await ready(page);
    await expect(
      page.getByRole("button", { name: "Compact list" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expectFits(page, "compact list");
    const rows = page.getByRole("main").getByRole("article");
    const count = Math.min(await rows.count(), 6);
    for (let index = 0; index < count; index += 1) {
      const row = await box(rows.nth(index));
      expect(
        row.height,
        `row ${index} is tall enough to press`,
      ).toBeGreaterThanOrEqual(40);
      const link = rows.nth(index).locator('h2 a[href^="/threads/"]');
      if ((await link.count()) === 0) continue;
      const title = await box(link.first());
      // Below the design width a row with a reaction chip leaves the title less room: the design
      // does not promise anything under 360 px (see `expectFits`).
      if (screen(page).width < 360 && title.width < 120)
        test.info().annotations.push({
          type: "found",
          description: `the title of row ${index} is ${Math.round(title.width)} px on a ${screen(page).width} px screen`,
        });
      else
        expect(
          title.width,
          `the title of row ${index} is not squeezed`,
        ).toBeGreaterThanOrEqual(120);
    }
    await markDocument();
    await page.getByRole("button", { name: "Cards" }).click();
    await expect(page.getByRole("button", { name: "Cards" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The save of the choice has to finish before the test ends, or the next project starts from
    // the wrong layout.
    await reloadedByPage();
  });

  // Item 13: the filter sheet.
  test("the feed filter sheet opens inside the screen, applies a forum and clears @all", async ({
    page,
  }) => {
    await visit(page, "/");
    await page.getByRole("button", { name: "Filters" }).click();
    const sheet = page.getByRole("dialog", { name: "Filter the feed" });
    await expect(sheet).toBeVisible();
    await expectFits(page, "filter sheet");
    const frame = await box(sheet);
    const size = screen(page);
    expect(frame.x + frame.width).toBeLessThanOrEqual(size.width + 1);
    expect(frame.y + frame.height).toBeLessThanOrEqual(size.height + 1);

    await sheet
      .getByRole("list", { name: "Forums" })
      .getByRole("checkbox")
      .first()
      .check();
    await sheet.getByRole("button", { name: "Show results" }).click();
    await expect(page).toHaveURL(/forums=\d+/);
    await expect(
      page.getByRole("button", { name: /^Filters \(1\)/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Remove the filter/ }),
    ).toBeVisible();
    await expectFits(page, "filtered feed");
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/forums=/);
  });

  // Item 19: text typed before the editor is in reaches it.
  test("text typed before the editor has loaded is not lost", async ({
    page,
  }) => {
    const { threadId } = seed();
    await visit(page, `/threads/${threadId}?page=3`);
    const reply = page.getByRole("region", { name: "Reply" });
    const field = reply.getByRole("textbox", {
      name: "Type your message here.",
    });
    await field.click();
    await field.pressSequentially("typed at once without waiting", {
      delay: 40,
    });
    await editorReady(reply);
    await expect(field).toContainText("typed at once without waiting");
  });

  // Item 21: keyboard shortcuts.
  test("the shortcut help opens with ?, Esc closes it, and g then c opens the conversations", async ({
    page,
  }) => {
    await visit(page, "/");
    await page.keyboard.press("?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expectFits(page, "shortcut help");
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
    await page.keyboard.press("g");
    await page.keyboard.press("c");
    await expect(page).toHaveURL(/\/conversations/);
  });

  // Items 1c and 16c: data saver on.
  test("with the data saver on the account menu draws no picture", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "forum_lite", value: "all", url: baseURL ?? "" },
    ]);
    const pictures: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/files/"))
        pictures.push(request.url());
    });
    await visit(page, "/");
    await page.getByRole("button", { name: "Account menu" }).click();
    const menu = page.getByRole("dialog", { name: "Account menu" });
    await expect(menu).toBeVisible();
    expect(await menu.locator("img").count()).toBe(0);
    expect(pictures).toEqual([]);
    // The link is on the Account tab; the menu opens on the alerts of a member who has some.
    await menu
      .getByRole("tablist", { name: "Account menu sections" })
      .getByRole("tab", { name: "Account" })
      .click();
    await expect(menu.getByRole("link", { name: /^Data saver/ })).toContainText(
      "On",
    );
    await expectFits(page, "account menu with the data saver");
  });
});

test.describe("guest", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // Item 30: a popup that is fetched on demand opens on the first press and gives the focus back.
  test("the site options menu opens with the keyboard, takes the focus and gives it back @all", async ({
    page,
  }) => {
    await visit(page, "/");
    await rejectCookies(page);
    const trigger = page.getByRole("button", { name: "Site options" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    expect(
      await menu.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await expectFits(page, "site options");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    // The arrow keys put the focus on an item.
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });

  // Item 18: each feed tab says what it is in the page's own head.
  test("the feed tabs carry their own title, canonical address and robots rule", async ({
    request,
    baseURL,
  }) => {
    const head = async (path: string, language = "en") => {
      const response = await request.get(path, {
        headers: { "accept-language": language, "user-agent": "Googlebot" },
      });
      expect(response.ok(), path).toBe(true);
      const html = await response.text();
      return {
        title: html.match(/<title>([^<]*)<\/title>/)?.[1],
        canonical: html.match(/<link rel="canonical" href="([^"]*)"/)?.[1],
        robots: html.match(/<meta name="robots" content="([^"]*)"/)?.[1],
        og: /<meta property="og:/.test(html),
      };
    };
    const latest = await head("/novedades");
    const hot = await head("/novedades?tab=hot");
    expect(hot.title).not.toBe(latest.title);
    expect(hot.canonical).toBe(`${baseURL}/novedades?tab=hot`);
    expect(hot.robots).toMatch(/^index/);
    const paged = await head("/novedades?tab=hot&cursor=x");
    expect(paged.robots).toMatch(/^noindex/);
    expect(paged.canonical).toBe(`${baseURL}/novedades?tab=hot`);
    const following = await head("/novedades?tab=following");
    expect(following.robots).toMatch(/^noindex/);
    expect(latest.og || hot.og).toBe(false);
    const spanish = await head("/novedades?tab=hot", "es");
    expect(spanish.title).not.toBe(hot.title);
  });
});
