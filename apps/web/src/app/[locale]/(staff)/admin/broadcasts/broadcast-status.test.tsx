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
const { BroadcastStatus } = await import("./broadcast-status");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restore);

const text = messages.adminCommunication.broadcasts.run;
const IDLE = {
  state: "idle",
  kind: null,
  dryRun: false,
  summary: "",
  startedAt: null,
  finishedAt: null,
  progress: 0,
  members: 0,
  matched: 0,
  reachable: 0,
  sent: 0,
  skipped: 0,
  error: null,
};
const words = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");

async function render(run: object) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "broadcasts.status": () => Response.json(run),
  });
  return htmlOf(await BroadcastStatus());
}

test("before any run it says so and offers nothing to stop or resume", async () => {
  const html = await render(IDLE);
  expect(html).toContain(text.idle);
  expect(html).not.toContain(text.stop);
  expect(html).not.toContain(text.resume);
});

test("a send under way shows its progress and the stop button", async () => {
  const html = await render({
    ...IDLE,
    state: "running",
    kind: "alert",
    summary: "Tonight",
    startedAt: "2026-10-21T10:00:00.000Z",
    progress: 0.4,
    sent: 26000,
  });
  expect(html).toContain("progressbar");
  expect(html).toContain(
    words(text.progress, {
      summary: "Tonight",
      percent: "40%",
      sent: "26,000",
    }),
  );
  expect(html).toContain(text.stop);
});

test("a stopped send is resumed or discarded behind the password; a stopped count has no password", async () => {
  const stopped = {
    ...IDLE,
    state: "stopped",
    kind: "message",
    summary: "Hello",
    startedAt: "2026-10-21T10:00:00.000Z",
    progress: 0.5,
    sent: 10,
  };
  const send = await render(stopped);
  expect(send).toContain(text.resume);
  expect(send).toContain(text.discard);
  expect(send).toContain('name="actorPassword"');
  const count = await render({ ...stopped, dryRun: true });
  expect(count).toContain(text.resumeCount);
  expect(count).toContain(text.discardCount);
  expect(count).not.toContain('name="actorPassword"');
});

test("a finished count says how many would be reached", async () => {
  const html = await render({
    ...IDLE,
    state: "done",
    kind: "message",
    dryRun: true,
    summary: "Hello",
    startedAt: "2026-10-21T10:00:00.000Z",
    finishedAt: "2026-10-21T10:05:00.000Z",
    progress: 1,
    members: 1000,
    matched: 900,
    skipped: 3,
  });
  expect(html).toContain(
    words(text.doneCount, {
      summary: "Hello",
      matched: "900",
      members: "1,000",
      skipped: "3",
    }),
  );
});

test("a finished count offers the send, naming the effect and the counted figure", async () => {
  const html = await render({
    ...IDLE,
    state: "done",
    kind: "alert",
    dryRun: true,
    summary: "Tonight",
    startedAt: "2026-10-21T10:00:00.000Z",
    finishedAt: "2026-10-21T10:05:00.000Z",
    progress: 1,
    members: 1000,
    matched: 900,
    reachable: 897,
    skipped: 3,
  });
  expect(html).toContain(text.sendCounted);
  expect(html).toContain(
    words(text.sendWarning, {
      summary: "Tonight",
      reachable: "897",
      when: "Oct 21, 2026, 10:05 AM",
    }),
  );
  expect(html).toContain('name="actorPassword"');
  // A finished real send offers nothing more.
  const sent = await render({
    ...IDLE,
    state: "done",
    kind: "alert",
    dryRun: false,
  });
  expect(sent).not.toContain(text.sendCounted);
});
