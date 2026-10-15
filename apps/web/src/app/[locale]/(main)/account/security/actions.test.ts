import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));

const { deleteAccount, revokeOtherDevices, updatePassword } = await import(
  "./actions"
);

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

// An account deletion asks who the visitor is first, then deletes, then signs out.
function backendOf(answers: Record<string, () => Response>) {
  const asked: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    const path = new URL(url).pathname;
    return (answers[path] ?? (() => Response.json({})))();
  }) as unknown as typeof fetch;
  return asked;
}

const member = () => Response.json(viewerBody(true));
const deletion = { confirmUsername: "ember", actorPassword: "right-password" };

test("a username that is not the member's is refused before the backend is asked to delete", async () => {
  const asked = backendOf({ "/api/v1/me": member });
  const state = await deleteAccount(
    null,
    form({ ...deletion, confirmUsername: "someone" }),
  );
  expect(state).toEqual({
    error: messages.account.security.delete.confirmMismatch,
  });
  expect(asked.map((entry) => new URL(entry.url).pathname)).toEqual([
    "/api/v1/me",
  ]);
});

test("a wrong password is shown on the password field", async () => {
  backendOf({
    "/api/v1/me": member,
    "/api/v1/me/delete-account": () =>
      Response.json(
        {
          error: {
            code: "forbidden",
            message: "That password is not correct.",
            issues: [{ path: ["password"], message: "Wrong" }],
          },
        },
        { status: 403 },
      ),
  });
  expect(await deleteAccount(null, form(deletion))).toEqual({
    error: undefined,
    fields: { actorPassword: "That password is not correct." },
  });
});

test("another refusal is shown as the form's message", async () => {
  backendOf({
    "/api/v1/me": member,
    "/api/v1/me/delete-account": () =>
      Response.json(
        {
          error: {
            code: "conflict",
            message: "Cannot remove the last administrator.",
          },
        },
        { status: 409 },
      ),
  });
  expect(await deleteAccount(null, form(deletion))).toEqual({
    error: "Cannot remove the last administrator.",
  });
});

test("a deleted account signs the browser out and lands on the home page with a notice", async () => {
  const asked = backendOf({
    "/api/v1/me": member,
    "/api/v1/me/delete-account": () => Response.json({ ok: true }),
  });
  const digest = await redirectedTo(() => deleteAccount(null, form(deletion)));
  expect(digest).toMatch(/^NEXT_REDIRECT;[a-z]+;\/\?notice=accountDeleted;/);
  expect(
    asked.map((entry) => [new URL(entry.url).pathname, entry.body]),
  ).toEqual([
    ["/api/v1/me", null],
    ["/api/v1/me/delete-account", { password: "right-password" }],
    ["/api/auth/sign-out", null],
  ]);
});
