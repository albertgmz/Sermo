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

const config = {
  autoShow: true,
  categories: {},
  language: { default: "en", translations: {} },
};

// A fresh copy of the module, which keeps the banner's state for the life of the page.
const load = (copy: string) => import(`./consent-library?${copy}`);

// What the library announces on a first choice: the categories the visitor kept.
const choice = (categories: string[]) =>
  new CustomEvent("cc:onFirstConsent", { detail: { cookie: { categories } } });

const { consentSettled, startConsent } = await load("sequence");

test("the offers wait for the banner to start and then for the visitor's first choice", async () => {
  let settled = false;
  const waiting = consentSettled().then(() => {
    settled = true;
  });
  await Bun.sleep(5);
  // The banner has not started yet.
  expect(settled).toBe(false);
  await startConsent(config);
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

for (const [name, categories] of [
  ["accept all", ["necessary", "referrals", "embeds"]],
  ["reject all", ["necessary"]],
] as const) {
  test(`the offers are let through by ${name}, and not before`, async () => {
    valid = false;
    const module = await load(name);
    await module.startConsent(config);
    let settled = false;
    const waiting = module.consentSettled().then(() => {
      settled = true;
    });
    await Bun.sleep(5);
    // The banner is up and unanswered.
    expect(settled).toBe(false);
    valid = true;
    page.dispatchEvent(choice([...categories]));
    await waiting;
    expect(settled).toBe(true);
  });
}

test("a visitor who chose on an earlier visit is not asked to wait", async () => {
  // The choice is kept in the library's cookie: `validConsent` is true when the banner starts.
  valid = true;
  const module = await load("returning");
  await module.startConsent(config);
  await module.consentSettled();
});
