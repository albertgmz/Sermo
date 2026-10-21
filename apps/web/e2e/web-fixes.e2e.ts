import { expect, MEMBER_STATE, test, visit } from "./fixtures";

// Browser checks of the web fixes (E7). A hydration mismatch is a console error, which fails every
// test (see `monitor` in fixtures.ts), so visiting the page is the check.

test.describe("signed in", () => {
  test.use({ storageState: MEMBER_STATE });

  // The XP bar spoke "77%" in the HTML of the server and "77 %" once the browser (set to Spanish)
  // drew it again: Base UI formats with the runtime's locale unless it is told one.
  test("the Spanish awards page hydrates and its level bars speak Spanish @all", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "forum_locale", value: "es", url: baseURL ?? "" },
    ]);
    await visit(page, "/awards");
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    const spoken = await page
      .locator('[role="progressbar"][aria-valuetext]')
      .evaluateAll((bars) =>
        bars.map((bar) => bar.getAttribute("aria-valuetext")),
      );
    for (const text of spoken) expect(text).toMatch(/^\d+ %$/);
    await context.addCookies([
      { name: "forum_locale", value: "en", url: baseURL ?? "" },
    ]);
  });
});
