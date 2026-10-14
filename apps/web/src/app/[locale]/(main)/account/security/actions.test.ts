import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

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

const { revokeOtherDevices, updatePassword } = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function backend(response: () => Response) {
  const asked: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    return response();
  }) as unknown as typeof fetch;
  return asked;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
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

const passwords = {
  currentPassword: "old-password",
  newPassword: "new-password",
  confirmPassword: "new-password",
};

test("two new passwords that differ are refused before the backend is asked", async () => {
  const asked = backend(() => Response.json({}));
  const state = await updatePassword(
    null,
    form({ ...passwords, confirmPassword: "other" }),
  );
  expect(state).toEqual({ error: messages.account.security.errors.mismatch });
  expect(asked).toEqual([]);
});

test("a wrong current password comes back as its own message", async () => {
  backend(() => Response.json({ code: "INVALID_PASSWORD" }, { status: 400 }));
  expect(await updatePassword(null, form(passwords))).toEqual({
    error: messages.account.security.errors.wrongCurrent,
  });
});

test("a changed password goes back to the security page with a notice", async () => {
  const asked = backend(() => Response.json({}));
  const digest = await redirectedTo(() =>
    updatePassword(null, form({ ...passwords, revokeOthers: "on" })),
  );
  expect(digest).toMatch(
    /^NEXT_REDIRECT;[a-z]+;\/account\/security\?notice=password#password;/,
  );
  expect(asked[0].url).toBe("http://127.0.0.1:8787/api/auth/change-password");
  expect(asked[0].body).toEqual({
    currentPassword: "old-password",
    newPassword: "new-password",
    revokeOtherSessions: true,
  });
});

test("a dead session on a device action is sent to sign in", async () => {
  backend(() => Response.json({ code: "UNAUTHORIZED" }, { status: 401 }));
  expect(await redirectedTo(revokeOtherDevices)).toMatch(
    /^NEXT_REDIRECT;[a-z]+;\/login;/,
  );
});
