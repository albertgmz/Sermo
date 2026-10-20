import { afterAll, expect, mock, test } from "bun:test";

// The banner library, faked: no choice recorded yet.
let valid = false;
mock.module("vanilla-cookieconsent", () => ({
  run: async () => {},
  validConsent: () => valid,
}));
const realWindow = globalThis.window;
const page = new EventTarget();
globalThis.window = page as unknown as typeof window;
afterAll(() => {
  globalThis.window = realWindow;
});

const { consentSettled, startConsent } = await import("./consent-library");

test("the offers wait for the banner to start and then for the visitor's first choice", async () => {
  let settled = false;
  const waiting = consentSettled().then(() => {
    settled = true;
  });
  await Bun.sleep(5);
  // The banner has not started yet.
  expect(settled).toBe(false);
  await startConsent({
    autoShow: true,
    categories: {},
    language: { default: "en", translations: {} },
  });
  await Bun.sleep(5);
  // Started, but the visitor has not chosen.
  expect(settled).toBe(false);
  valid = true;
  page.dispatchEvent(new Event("cc:onFirstConsent"));
  await waiting;
  expect(settled).toBe(true);
  // Once chosen, it is settled at once.
  await consentSettled();
});
