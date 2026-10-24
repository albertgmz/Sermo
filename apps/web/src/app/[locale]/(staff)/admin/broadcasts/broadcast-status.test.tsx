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
  startedBy: null,
  sender: null,
  finishedAt: null,
  progress: 0,
  members: 0,
  matched: 0,
  reachable: 0,
  sent: 0,
  skipped: 0,
  error: null,
};

async function render(run: object, kind: "message" | "alert" = "message") {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "broadcasts.status": () => Response.json(run),
  });
  return htmlOf(await BroadcastStatus({ kind }));
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
    "Sending the alert “Tonight”: 40%. 26,000 sent so far.",
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
  // The texts name the run, and the buttons post which one it is.
  expect(send).toContain(
    "The send of the direct message “Hello” stopped at 50% with 10 sent.",
  );
  expect(send).toContain(
    "Continues the stopped send of the direct message “Hello”, started Oct 21, 2026, 10:00 AM,",
  );
  expect(send).toContain("Gives up the send of the direct message “Hello”");
  expect(send).toContain('name="runAt" value="2026-10-21T10:00:00.000Z"');
  expect(send).toContain('name="kind" value="message"');
  const count = await render({ ...stopped, dryRun: true });
  expect(count).toContain(text.resumeCount);
  expect(count).toContain(text.discardCount);
  expect(count).not.toContain('name="actorPassword"');
  expect(count).toContain(
    "The count for the direct message “Hello” stopped at 50%.",
  );
  expect(count).toContain('name="runAt" value="2026-10-21T10:00:00.000Z"');
});

test("a stopped run is resumed or discarded only from the page of its kind", async () => {
  const stopped = {
    ...IDLE,
    state: "stopped",
    kind: "message",
    summary: "Hello",
    startedAt: "2026-10-21T10:00:00.000Z",
    progress: 0.5,
    sent: 10,
  };
  for (const dryRun of [false, true]) {
    const html = await render({ ...stopped, dryRun }, "alert");
    for (const label of [
      text.resume,
      text.discard,
      text.resumeCount,
      text.discardCount,
    ])
      expect(html).not.toContain(label);
    expect(html).toContain(
      "The run that is stopped is a direct message: resume or discard it from the message page.",
    );
  }
});

test("the stop button names the run under way", async () => {
  const html = await render({
    ...IDLE,
    state: "running",
    kind: "message",
    summary: "Hello",
    startedAt: "2026-10-21T10:00:00.000Z",
  });
  expect(html).toContain('name="runAt" value="2026-10-21T10:00:00.000Z"');
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
    "The direct message “Hello” would reach 900 of 1,000 members; 3 of them could not receive it.",
  );
});

test("a finished count offers the send, naming the effect and the counted figure", async () => {
  const html = await render(
    {
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
    },
    "alert",
  );
  expect(html).toContain(text.sendCounted);
  expect(html).toContain(
    "This sends the alert “Tonight” to 897 members, as counted on Oct 21, 2026, 10:05 AM. It cannot be recalled.",
  );
  expect(html).toContain('name="actorPassword"');
  // The count that was looked at is the one the send names.
  expect(html).toContain('name="countedAt" value="2026-10-21T10:00:00.000Z"');
  // A finished real send offers nothing more.
  const sent = await render({
    ...IDLE,
    state: "done",
    kind: "alert",
    dryRun: false,
  });
  expect(sent).not.toContain(text.sendCounted);
});

test("a page offers only the send of a count of its own kind, and says whose it is", async () => {
  const counted = {
    ...IDLE,
    state: "done",
    kind: "message",
    dryRun: true,
    summary: "Hello",
    startedAt: "2026-10-21T10:00:00.000Z",
    finishedAt: "2026-10-21T10:05:00.000Z",
    progress: 1,
    reachable: 5,
    startedBy: { id: 1, username: "Ana" },
    sender: { id: 2, username: "Staff" },
  };
  const own = await render(counted, "message");
  expect(own).toContain(text.sendCounted);
  expect(own).toContain("This sends the direct message “Hello” to 5 members");
  expect(own).toContain("Started by Ana.");
  expect(own).toContain("Sent as Staff.");
  const other = await render(counted, "alert");
  expect(other).not.toContain(text.sendCounted);
  expect(other).toContain("send it from the message page");
});
