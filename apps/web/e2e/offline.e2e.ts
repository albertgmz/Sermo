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
    // Only a production build writes the worker: a development server has none.
    const script = await request.get("/sw.js");
    test.skip(
      !script.ok() ||
        !(script.headers()["content-type"] ?? "").includes("javascript"),
      "this server has no service worker (a development build)",
    );
    await page.goto("/");
    await ready(page);
    const scope = await page.evaluate(
      async () => (await navigator.serviceWorker.ready).scope,
    );
    expect(scope).toBe(`${new URL(page.url()).origin}/`);

    await context.setOffline(true);
    await page.goto("/forums").catch(() => {});
    await expect(
      page.getByRole("heading", { name: "You are offline" }),
    ).toBeVisible();
    await expectFits(page, "offline page from the worker");
    await context.setOffline(false);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByRole("heading", { name: "Forums", level: 1 }),
    ).toBeVisible();
  });
});
