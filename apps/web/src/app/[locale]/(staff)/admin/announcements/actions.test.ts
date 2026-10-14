import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { form, invalid, redirectedTo } from "../content-kit/harness";
import { fakeBackend, refusal } from "../groups/test-backend";

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

const { sendAnnouncement } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

test("a confirmed announcement is sent with its title and text", async () => {
  backend = fakeBackend({
    "announcements.create": () => Response.json({ id: 1 }),
  });
  const digest = await redirectedTo(() =>
    sendAnnouncement(
      null,
      form([
        ["title", "Maintenance"],
        ["body", "Tonight."],
        ["confirm", "on"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/announcements\?notice=sent;/);
  expect(backend.asked[0]?.body).toEqual({
    title: "Maintenance",
    body: "Tonight.",
  });
});

test("nothing is sent without the confirmation", async () => {
  backend = fakeBackend({});
  const state = await sendAnnouncement(
    null,
    form([
      ["title", "Maintenance"],
      ["body", "Tonight."],
    ]),
  );
  expect(backend.asked).toEqual([]);
  expect(state).toEqual({ error: messages.adminCommunication.errors.confirm });
});

test("the backend's refusal is shown next to its field", async () => {
  backend = fakeBackend({
    "announcements.create": () => invalid("title", "Too long."),
  });
  const state = await sendAnnouncement(
    null,
    form([
      ["title", "x"],
      ["body", "y"],
      ["confirm", "on"],
    ]),
  );
  expect(state).toEqual({ fields: { title: "Too long." } });
});

test("a refusal without a field is shown at the top", async () => {
  backend = fakeBackend({
    "announcements.create": () => refusal(403, "forbidden", "Not allowed."),
  });
  const state = await sendAnnouncement(
    null,
    form([
      ["title", "x"],
      ["body", "y"],
      ["confirm", "on"],
    ]),
  );
  expect(state).toEqual({ error: "Not allowed." });
});
