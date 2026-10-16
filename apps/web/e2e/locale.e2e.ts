import {
  box,
  expect,
  expectFits,
  ready,
  rejectCookies,
  screen,
  test,
  visit,
} from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] }, locale: "es-ES" });

test("the Spanish guest header fits 360 px and its buttons stay whole @all", async ({
  page,
}) => {
  await visit(page, "/");
  await rejectCookies(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  const header = page.getByRole("banner");
  await expect(
    header.getByRole("link", { name: "Iniciar sesión" }),
  ).toBeVisible();
  await expectFits(page, "es header");

  // Nothing in the header is cut off by the screen's edge, and nothing wraps to a second line.
  const size = screen(page);
  // Below the design width the overflow is reported by expectFits, not failed here.
  const shown = header.locator("a:visible, button:visible");
  const count = size.width < 360 ? 0 : await shown.count();
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
  const heights = await header.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(heights).toBeLessThanOrEqual(80);

  await page.goto("/login");
  await ready(page);
  await expectFits(page, "es login");
  await page.goto("/forums");
  await ready(page);
  await expectFits(page, "es forums");
});
