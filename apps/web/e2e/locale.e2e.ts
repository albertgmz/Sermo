import {
  expect,
  expectFits,
  expectHeaderOnScreen,
  ready,
  rejectCookies,
  test,
  visit,
} from "./fixtures";

test.use({
  storageState: { cookies: [], origins: [] },
  locale: "es-ES",
  language: "es",
});

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
  await expectHeaderOnScreen(page);

  await page.goto("/login");
  await ready(page);
  await expectFits(page, "es login");
  await page.goto("/");
  await ready(page);
  await expectFits(page, "es forum list");
});
