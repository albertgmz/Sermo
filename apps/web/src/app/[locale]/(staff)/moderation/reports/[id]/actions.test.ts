import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../../../admin/groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { setReportState } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const GROUP = {
  id: 4,
  targetType: "post",
  targetId: 9,
  state: "resolved",
  assignedToId: null,
  reportCount: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  resolvedAt: "2026-01-01T00:00:00.000Z",
};

function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

test("a state is saved with the note and ends in a redirect with a notice", async () => {
  backend = fakeBackend({
    "reports.setState": () => Response.json(GROUP),
  });
  const digest = await redirectedTo(() =>
    setReportState(
      null,
      form([
        ["groupId", "4"],
        ["state", "resolved"],
        ["reason", "Handled"],
        ["notify", "on"],
        ["message", "  "],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/moderation\/reports\/4\?notice=stateSaved;/);
  expect(backend.asked.at(-1)).toMatchObject({
    operation: "reports.setState",
    body: { state: "resolved", reason: "Handled", notify: true },
  });
  expect(
    (backend.asked[0].body as Record<string, unknown>).message,
  ).toBeUndefined();
});

test("a state the contract does not offer is refused before the call", async () => {
  backend = fakeBackend({});
  expect(
    await setReportState(
      null,
      form([
        ["groupId", "4"],
        ["state", "open"],
      ]),
    ),
  ).toEqual({ fields: { state: messages.moderation.errors.state } });
  expect(backend.asked).toEqual([]);
});

test("a group that is not an id is refused before the call", async () => {
  backend = fakeBackend({});
  expect(
    await setReportState(
      null,
      form([
        ["groupId", "0x4"],
        ["state", "resolved"],
      ]),
    ),
  ).toEqual({ error: messages.moderation.errors.id });
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal is shown at the top", async () => {
  backend = fakeBackend({
    "reports.setState": () => refusal(404, "not_found", "Not found."),
  });
  expect(
    await setReportState(
      null,
      form([
        ["groupId", "4"],
        ["state", "rejected"],
      ]),
    ),
  ).toEqual({ error: "Not found." });
});
