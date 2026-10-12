import { afterEach, expect, mock, test } from "bun:test";
import { fakeBackend, refusal } from "../../../groups/test-backend";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { lookupThreadBans } = await import("./thread-bans");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const ban = {
  threadId: 8,
  userId: 7,
  moderatorId: 2,
  reason: "Off topic",
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
};

test("the bans of a thread are listed for a viewer the backend allows", async () => {
  backend = fakeBackend({
    "threadBans.list": () => Response.json({ items: [ban] }),
  });
  expect(await lookupThreadBans(8)).toEqual({ items: [ban], refusal: null });
  expect(backend.asked[0].path).toBe("/api/v1/threads/8/bans");
});

test("a refusal of the backend is answered with its own words", async () => {
  backend = fakeBackend({
    "threadBans.list": () =>
      refusal(403, "forbidden", "You do not have permission to do that."),
  });
  expect(await lookupThreadBans(8)).toEqual({
    items: null,
    refusal: "You do not have permission to do that.",
  });
  backend.restore();
  backend = fakeBackend({
    "threadBans.list": () => refusal(404, "not_found", "Not found."),
  });
  expect(await lookupThreadBans(8)).toEqual({
    items: null,
    refusal: "Not found.",
  });
});

test("any other failure is raised", async () => {
  backend = fakeBackend({
    "threadBans.list": () => refusal(500, "internal", "Broken."),
  });
  await expect(lookupThreadBans(8)).rejects.toThrow();
});
