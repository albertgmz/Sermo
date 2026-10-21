import { expect, expectFits, ready, test } from "./fixtures";

test.use({ storageState: { cookies: [], origins: [] } });

test("the offline page renders in English and fits the screen @all", async ({
  page,
}) => {
  await page.goto("/offline.html");
  await expect(
    page.getByRole("heading", { name: "You are offline" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expectFits(page, "offline page");
});

test.describe("Spanish device", () => {
  test.use({ locale: "es-ES" });

  test("the offline page follows the device language @all", async ({
    page,
  }) => {
    await page.goto("/offline.html");
    await expect(
      page.getByRole("heading", { name: "Sin conexión" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "You are offline" }),
    ).toBeHidden();
    await expectFits(page, "offline page in Spanish");
  });
});

test("the manifest names the site and carries icons @all", async ({
  request,
}) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toBeTruthy();
  expect(manifest.display).toBe("standalone");
  expect(manifest.theme_color).toMatch(/^#/);
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
});

// Failed requests while the connection is cut are logged by the browser on purpose.
test.describe("service worker", () => {
  test.use({ allowConsoleErrors: true });

  test("the service worker registers and a lost connection shows the offline page", async ({
    page,
    context,
    request,
  }) => {
    // Only a production build registers the worker; a development server's pages load the hot
    // reload client.
    const home = await request.get("/");
    test.skip(
      (await home.text()).includes("browser_dev_hmr-client"),
      "a development server registers no service worker",
    );
    const script = await request.get("/sw.js");
    expect(script.ok(), "a production build serves /sw.js").toBe(true);
    await page.goto("/");
    await ready(page);
    // Registered with the whole site as its scope, and active.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const registration =
              await navigator.serviceWorker.getRegistration();
            return registration?.active ? registration.scope : null;
          }),
        { timeout: 30_000 },
      )
      .toBe(`${new URL(page.url()).origin}/`);

    await context.setOffline(true);
    // Another page than the one the visitor is on, and one that exists (`/forums` is now a
    // redirect to the home page): the retry must reload what was asked for.
    await page.goto("/novedades").catch(() => {});
    await expect(
      page.getByRole("heading", { name: "You are offline" }),
    ).toBeVisible();
    await expectFits(page, "offline page from the worker");
    await context.setOffline(false);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/novedades");
    await expect(
      page.getByRole("heading", { name: "You are offline" }),
    ).toBeHidden();
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  });
});
