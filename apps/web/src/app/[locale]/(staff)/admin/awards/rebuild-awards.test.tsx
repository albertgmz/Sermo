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
const { RebuildAwards } = await import("./rebuild-awards");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restore);

const text = messages.adminEconomy.awards.rebuild;
const IDLE = {
  state: "idle",
  dryRun: false,
  startedAt: null,
  finishedAt: null,
  progress: 0,
  members: 0,
  xpCorrected: 0,
  xpChanged: 0,
  levelsUp: 0,
  levelsDown: 0,
  totalsCorrected: 0,
  granted: 0,
  takenBack: 0,
  creditsPaid: 0,
  creditsRemoved: 0,
  newlyNegative: 0,
  awards: [],
  error: null,
};

async function render(run: object) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "awards.rebuildStatus": () => Response.json(run),
  });
  return htmlOf(await RebuildAwards());
}
const words = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");

test("before any run the button names the effect and asks for the password", async () => {
  const html = await render(IDLE);
  expect(html).toContain(text.idle);
  expect(html).toContain(text.rebuild);
  expect(html).toContain(text.warning);
  expect(html).toContain('name="actorPassword"');
  expect(html).not.toContain("progressbar");
});

test("a run under way shows its progress and no button", async () => {
  const html = await render({
    ...IDLE,
    state: "running",
    startedAt: "2026-10-21T10:00:00.000Z",
    progress: 0.4,
    members: 26000,
    granted: 5,
    takenBack: 7,
  });
  expect(html).toContain("progressbar");
  expect(html).toContain(
    words(text.progress, { percent: "40%", granted: "5", takenBack: "7" }),
  );
  expect(html).not.toContain(text.rebuild);
});

test("a finished run shows what it changed and can be run again", async () => {
  const html = await render({
    ...IDLE,
    state: "done",
    startedAt: "2026-10-21T10:00:00.000Z",
    finishedAt: "2026-10-21T11:00:00.000Z",
    progress: 1,
    members: 60000,
    xpCorrected: 12,
    levelsUp: 4,
    levelsDown: 9,
    granted: 300,
    takenBack: 40,
    creditsPaid: 3000,
    creditsRemoved: 400,
    newlyNegative: 2,
  });
  expect(html).toContain(
    "60,000 members looked at, 12 had their XP or counters corrected",
  );
  expect(html).toContain(
    "4 went up a level and 9 went down, 300 awards given and 40 taken back",
  );
  expect(html).toContain("2 members ended with a negative balance");
  expect(html).toContain(text.rebuild);
});

test("a preview lists what it would change by award, offers to preview again and never claims a rebuild happened", async () => {
  const html = await render({
    ...IDLE,
    state: "done",
    dryRun: true,
    startedAt: "2026-10-21T10:00:00.000Z",
    progress: 1,
    members: 60000,
    granted: 300,
    takenBack: 40,
    awards: [{ awardId: 3, name: "1 week", granted: 290, takenBack: 35 }],
  });
  expect(html).toContain("Preview of 60,000 members, nothing was changed");
  expect(html).not.toContain("Last run:");
  expect(html).toContain("1 week");
  expect(html.replaceAll("<!-- -->", "")).toContain("290 / 35");
  expect(html).toContain(text.preview);
});

test("while a run is under way the only button stops it", async () => {
  const html = await render({ ...IDLE, state: "running", progress: 0.1 });
  expect(html).toContain(text.stop);
  expect(html).not.toContain(text.preview);
  expect(html).not.toContain('name="actorPassword"');
});

test("a run that was stopped says so and offers to resume it", async () => {
  const html = await render({ ...IDLE, state: "stopped", progress: 0.3 });
  expect(html).toContain(words(text.stopped, { percent: "30%" }));
  expect(html).toContain(text.resume);
});

test("a run that stopped shows the error and offers to resume it", async () => {
  const html = await render({
    ...IDLE,
    state: "failed",
    startedAt: "2026-10-21T10:00:00.000Z",
    progress: 0.5,
    error: "disk full",
  });
  expect(html).toContain(
    words(text.failed, { percent: "50%", error: "disk full" }),
  );
  expect(html).toContain(text.resume);
});

test("a stopped or failed preview says nothing was changed and offers to continue the preview, not a real run", async () => {
  for (const state of ["stopped", "failed"]) {
    const html = await render({
      ...IDLE,
      state,
      dryRun: true,
      progress: 0.4,
      error: "disk full",
    });
    expect(html).toContain("Nothing was changed.");
    expect(html).toContain(text.previewResume);
    expect(html).not.toContain(text.resume);
    expect(html).not.toContain("Nothing is lost");
  }
});
