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
  startedAt: null,
  finishedAt: null,
  progress: 0,
  members: 0,
  xpCorrected: 0,
  levelsChanged: 0,
  granted: 0,
  takenBack: 0,
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
    levelsChanged: 9,
    granted: 300,
    takenBack: 40,
  });
  expect(html).toContain(
    words(text.done, {
      members: "60,000",
      xpCorrected: "12",
      levels: "9",
      granted: "300",
      takenBack: "40",
    }),
  );
  expect(html).toContain(text.rebuild);
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
