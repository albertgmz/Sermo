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
const { RevokeUnqualified } = await import("./revoke-unqualified");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restore);

const text = messages.adminEconomy.awards.revoke;
const IDLE = {
  state: "idle",
  mode: null,
  startedAt: null,
  finishedAt: null,
  progress: 0,
  members: 0,
  affectedMembers: 0,
  grants: 0,
  xp: 0,
  credits: 0,
  awards: [],
  error: null,
};
const COUNTED = {
  ...IDLE,
  state: "done",
  mode: "count",
  startedAt: "2026-10-20T10:00:00.000Z",
  finishedAt: "2026-10-20T11:00:00.000Z",
  progress: 1,
  members: 60000,
  affectedMembers: 54000,
  grants: 210000,
  xp: 1500000,
  credits: 420,
  awards: [
    { awardId: 3, name: "1 week", grants: 60000 },
    { awardId: 4, name: "10 years", grants: 41000 },
  ],
};

async function render(run: object) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "awards.revokeStatus": () => Response.json(run),
  });
  return htmlOf(await RevokeUnqualified());
}
const words = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");

test("before anything is counted the only button counts", async () => {
  const html = await render(IDLE);
  expect(html).toContain(text.idle);
  expect(html).toContain(text.count);
  expect(html).not.toContain(text.revoke);
  expect(html).not.toContain("<progress");
});

test("a finished count shows the totals and the awards, and offers to take them back", async () => {
  const html = await render(COUNTED);
  expect(html).toContain(
    words(text.doneCount, {
      members: "60,000",
      grants: "210,000",
      affected: "54,000",
      xp: "1,500,000",
      credits: "420",
    }).replace(/&/g, "&amp;"),
  );
  for (const name of ["1 week", "10 years", "60,000", "41,000"])
    expect(html).toContain(name);
  expect(html).toContain(text.recount);
  expect(html).toContain(text.revoke);
  expect(html).toContain(text.revokeNow);
  expect(html).toContain("54,000 members");
});

test("a count that found nothing offers nothing to take back", async () => {
  const html = await render({
    ...COUNTED,
    grants: 0,
    affectedMembers: 0,
    awards: [],
  });
  expect(html).toContain("everyone still meets the rules");
  expect(html).not.toContain(text.revokeNow);
});

test("a run under way shows how far it is and offers no button", async () => {
  const html = await render({
    ...COUNTED,
    state: "running",
    mode: "revoke",
    finishedAt: null,
    progress: 0.25,
  });
  expect(html).toContain(text.aria);
  expect(html).toContain("25%");
  expect(html).toContain("Taking back:");
  expect(html).not.toContain(text.count);
  expect(html).not.toContain(text.revokeNow);
});

test("a run that stopped on an error says why and offers to resume it", async () => {
  const stopped = {
    ...COUNTED,
    state: "failed",
    progress: 0.5,
    error: "disk full",
  };
  const revoking = await render({ ...stopped, mode: "revoke" });
  expect(revoking).toContain("disk full");
  expect(revoking).toContain(text.resumeRevoke);
  const counting = await render(stopped);
  expect(counting).toContain("disk full");
  expect(counting).toContain(text.resumeCount);
  expect(counting).not.toContain(text.revokeNow);
});

test("a finished revoke reports what was taken back and offers a new count", async () => {
  const html = await render({ ...COUNTED, mode: "revoke" });
  expect(html).toContain("Done: 210,000 grants taken back from 54,000 members");
  expect(html).toContain(text.recount);
  expect(html).not.toContain(text.revokeNow);
});
