import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, requireCredentials } from "./e2e/target";

// Phone and tablet checks of a running site. The address comes from E2E_BASE_URL (a local stack or
// staging); the suite starts no server. The members are E2E_USER and E2E_PEER with E2E_PASSWORD (required for any address but the default).
//
// Every project runs the flows tagged "@all"; the 360 px phone (`android-small`) runs all of them.
// The landing flows ("@landing") also run on the small iPhone and on a desktop window. The iPhone
// and iPad projects use WebKit, the rest Chromium.
requireCredentials();
const baseURL = BASE_URL;

const everyFlow = /@all/;
const landing = /@all|@landing/;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  // The session and the seed note are kept in test-results/.state, outside the folder Playwright
  // empties at the start of every run.
  outputDir: "./test-results/output",
  // The first visit of a page on a development server compiles it, which takes seconds.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    trace: "retain-on-failure",
    // WebKit does not route the requests of a page a service worker controls: the seeded pictures'
    // fake host (`PICTURE_HOST`) would then be looked up for real and logged as an unresolved name.
    // The service worker's own spec turns it back on.
    serviceWorkers: "block",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /setup\.e2e\.ts/,
      use: { ...devices["Galaxy S8"] },
    },
    {
      // 360 x 740 CSS pixels: the width the web app is designed for.
      name: "android-small",
      testIgnore: /setup\.e2e\.ts/,
      use: { ...devices["Galaxy S8"] },
      dependencies: ["setup"],
    },
    {
      name: "android-large",
      testIgnore: /setup\.e2e\.ts/,
      grep: everyFlow,
      use: { ...devices["Pixel 7"] },
      dependencies: ["setup"],
    },
    {
      // 320 x 568: narrower than the design width.
      name: "iphone-small",
      testIgnore: /setup\.e2e\.ts/,
      grep: landing,
      use: { ...devices["iPhone SE"] },
      dependencies: ["setup"],
    },
    {
      name: "iphone-large",
      testIgnore: /setup\.e2e\.ts/,
      grep: everyFlow,
      use: { ...devices["iPhone 15 Pro Max"] },
      dependencies: ["setup"],
    },
    {
      // A desktop window, for the landing flows: a wider header and the header's own panels.
      name: "desktop",
      testIgnore: /setup\.e2e\.ts/,
      grep: /@landing/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
      dependencies: ["setup"],
    },
    {
      name: "tablet",
      testIgnore: /setup\.e2e\.ts/,
      grep: everyFlow,
      use: { ...devices["iPad Mini"] },
      dependencies: ["setup"],
    },
  ],
});
