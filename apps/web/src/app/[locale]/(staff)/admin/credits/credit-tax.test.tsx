import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend } from "../groups/test-backend";
import { htmlOf, mockIntl } from "./test-render";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ refresh() {} }),
}));
const restoreIntl = await mockIntl();
afterAll(() => {
  restoreIntl();
  mock.module("next/navigation", () => navigation);
});
const { CreditTax } = await import("./credit-tax");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const text = messages.adminEconomy.tax;
const PREVIEW = {
  id: 3,
  kind: "preview",
  chargeOn: "2026-11-01",
  state: "done",
  fee: 50,
  minimum: 1000,
  step: 2,
  progress: 1,
  members: 1210,
  credits: 45678,
  top: [
    {
      user: { id: 7, username: "Yoan" },
      balance: 210,
      months: 60,
      charge: 105,
    },
  ],
  startedAt: "2026-10-26T10:00:00.000Z",
  finishedAt: "2026-10-26T10:01:00.000Z",
};

async function render(status: object) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "credits.taxStatus": () =>
      Response.json({
        enabled: false,
        nextChargeOn: null,
        preview: null,
        lastCharge: null,
        ...status,
      }),
  });
  return htmlOf(await CreditTax());
}

test("while off and before any preview it says so and offers a preview", async () => {
  const html = await render({});
  expect(html).toContain(text.heading);
  expect(html).toContain(text.off);
  expect(html).toContain(text.idle);
  expect(html).toContain(text.run);
  expect(html).toContain(
    'href="/admin/settings/levels?setting=creditTaxEnabled"',
  );
});

test("a finished preview shows its figures and the largest charges", async () => {
  const html = await render({
    enabled: true,
    nextChargeOn: "2026-11-01",
    preview: PREVIEW,
  });
  expect(html).toContain("The tax is on. The next charge is on Nov 1, 2026.");
  expect(html).toContain(
    "Preview of the charge on Nov 1, 2026, with a fee of 50 credits above 1,000 credits and 2% for each month without a visit. Members charged: 1,210. Credits in total: 45,678.",
  );
  expect(html).toContain('href="/members/7"');
  expect(html).toContain("105 of 210 credits, 60 months without a visit");
  expect(html).toContain(text.run);
});

test("a preview under way shows its progress and no button; the last charge shows its state", async () => {
  const html = await render({
    enabled: true,
    nextChargeOn: "2026-12-01",
    preview: { ...PREVIEW, state: "running", progress: 0.4, top: [] },
    lastCharge: {
      ...PREVIEW,
      kind: "charge",
      state: "stopped",
      members: 12,
      credits: 340,
    },
  });
  expect(html).toContain(text.aria);
  expect(html).toContain("Preview of the charge on Nov 1, 2026: 40% done.");
  expect(html).not.toContain(text.run);
  expect(html).toContain(
    "Last charge, on Nov 1, 2026: 12 members, 340 credits in total (stopped because the tax was turned off).",
  );
});
