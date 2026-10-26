import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { viewerBody } from "@/lib/test-viewer";
import { htmlOf, mockIntl } from "../credits/test-render";
import { fakeBackend } from "../groups/test-backend";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ refresh() {} }),
}));
const restoreIntl = await mockIntl();
const restore = () => {
  restoreIntl();
  mock.module("next/navigation", () => navigation);
};
const { PastActivity } = await import("./past-activity");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restore);

const text = messages.adminEconomy.rules.past;
const PREVIEWED = {
  id: 4,
  mode: "preview",
  state: "done",
  previewId: null,
  from: "2020-01-01",
  until: "2026-10-26",
  cap: 20000,
  progress: 1,
  startedAt: "2026-10-26T10:00:00.000Z",
  finishedAt: "2026-10-26T10:05:00.000Z",
  error: null,
  summary: {
    members: 4210,
    credits: 1234567,
    heldAtCap: 12,
    byTrigger: [
      { trigger: "reply_posted", credits: 900000 },
      { trigger: "followed", credits: 0 },
    ],
    paid: { p50: 40, p90: 800, p99: 9000, max: 20000 },
    top: [{ user: { id: 7, username: "Yoan" }, total: 54000, paid: 20000 }],
  },
};

async function render(latest: object | null, paidRange: object | null = null) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "creditRules.backfillStatus": () => Response.json({ latest, paidRange }),
  });
  return htmlOf(await PastActivity());
}
const words = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");

test("before any run the form offers a preview from 2020 to today with a cap of 20,000", async () => {
  const html = await render(null);
  expect(html).toContain(text.heading);
  expect(html).toContain(text.idle);
  expect(html).toContain('value="2020-01-01"');
  expect(html).toContain(`value="${new Date().toISOString().slice(0, 10)}"`);
  expect(html).toContain('value="20000"');
  expect(html).toContain(text.preview);
  expect(html).not.toContain(text.applyNow);
  expect(html).not.toContain("<progress");
});

test("a finished preview shows its figures and offers to pay it", async () => {
  const html = await render(PREVIEWED);
  expect(html).toContain(
    words(text.donePreview, {
      from: "Jan 1, 2020",
      until: "Oct 26, 2026",
      cap: "20,000",
      members: "4,210",
      credits: "1,234,567",
    }),
  );
  for (const figure of ["12", "40", "800", "9,000", "20,000", "900,000", "0"])
    expect(html).toContain(`>${figure}</dd>`);
  expect(html).toContain("Yoan");
  expect(html).toContain(messages.adminEconomy.rules.triggers.reply_posted);
  expect(html).toContain('href="/members/7"');
  expect(html).toContain(text.applyNow);
  expect(html).toContain('name="previewId" value="4"');
});

test("a run under way shows how far it is, and neither the form nor the payment can start", async () => {
  const html = await render({
    ...PREVIEWED,
    mode: "apply",
    previewId: 4,
    state: "running",
    progress: 0.25,
    finishedAt: null,
    summary: null,
  });
  expect(html).toContain(text.aria);
  expect(html).toContain("25%");
  expect(html).toContain(words(text.progressApply, { percent: "25%" }));
  expect(html).toMatch(/<fieldset[^>]* disabled/);
  expect(html).not.toContain(text.applyNow);
});

test("a finished payment shows what it paid and the dates paid, with nothing more to pay", async () => {
  const html = await render(
    { ...PREVIEWED, id: 5, mode: "apply", previewId: 4 },
    { from: "2020-01-01", until: "2026-10-26" },
  );
  expect(html).toContain("Paid for the activity from Jan 1, 2020");
  expect(html).toContain(
    words(text.paidRange, { from: "Jan 1, 2020", until: "Oct 26, 2026" }),
  );
  expect(html).not.toContain(text.applyNow);
});

test("a run that stopped on an error says why", async () => {
  const html = await render({
    ...PREVIEWED,
    mode: "apply",
    previewId: 4,
    state: "failed",
    progress: 0.5,
    summary: null,
    error: "disk full",
  });
  expect(html).toContain("disk full");
  expect(html).toContain("50%");
  expect(html).not.toContain(text.applyNow);
});
