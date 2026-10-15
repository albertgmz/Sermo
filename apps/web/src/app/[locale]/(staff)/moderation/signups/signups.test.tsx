import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { SermoError } from "@/lib/sermo/errors";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const intl = await import("next-intl/server");
// The rows read their words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));

const { SignupList } = await import("./signup-list");
const { DecisionResult } = await import("./decision-result");

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const at = "2026-01-01T00:00:00.000Z";

const ENTRIES = [
  {
    user: { id: 41, username: "wren" },
    email: "wren@example.test",
    createdAt: at,
    flagged: true,
    country: "ES",
    ip: "203.0.113.9",
    sharedAddress: {
      accounts: 2,
      banned: 1,
      members: [
        { id: 12, username: "robin" },
        { id: 13, username: "jay" },
      ],
    },
    acceptances: [
      { kind: "terms", version: 3, acceptedAt: at },
      { kind: "rules", version: 2, acceptedAt: at },
    ],
  },
  {
    // What a viewer without the address permission is given: no address, nothing shared.
    user: { id: 42, username: "finch" },
    email: "finch@example.test",
    createdAt: at,
    flagged: false,
    country: null,
    ip: null,
    sharedAddress: null,
    acceptances: [],
  },
];

// A backend that answers the viewer (with the permissions given) and the queue, and records the
// requests it gets.
function backend(
  held: Record<string, boolean> = {},
  list: () => Response = () =>
    Response.json({ items: ENTRIES, nextCursor: "next-page" }),
) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const { pathname } = new URL(input);
    if (pathname === "/api/v1/me") {
      const viewer = viewerBody(true);
      return Response.json({
        ...viewer,
        resolvedPermissions: held,
        staff: { ...viewer.staff, panel: true },
      });
    }
    asked.push(pathname);
    if (pathname === "/api/v1/admin/signups") return list();
    return Response.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  return asked;
}

async function html(page: Promise<React.ReactNode>) {
  const stream = await renderToReadableStream(withIntl(await page));
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("&#x27;", "'");
}

const queue = () => SignupList({ searchParams: Promise.resolve({}) });

test("each waiting account shows what the backend gave, and nothing it left out", async () => {
  const asked = backend({
    "member.approveRegistrations": true,
    "admin.members": true,
    "member.viewIps": true,
  });
  const page = await html(queue());
  const s = messages.moderation.signups;
  expect(page).toContain("wren@example.test");
  expect(page).toContain(s.flagged);
  expect(page).toContain("Spain (ES)");
  expect(page).toContain("203.0.113.9");
  expect(page).toContain("/moderation/ips?ip=203.0.113.9");
  expect(page).toContain("2 other accounts, 1 banned");
  expect(page).toContain("robin");
  expect(page).toContain("jay");
  expect(page).toContain("Terms version 3");
  expect(page).toContain("Rules version 2");
  // The username links to the panel's page of the member.
  expect(page).toContain('href="/admin/users/41"');
  // The second account has none of the optional facts: no flag for it, no address, no country.
  expect(page.split(s.flagged)).toHaveLength(2);
  expect(page.split(s.address)).toHaveLength(2);
  expect(page.split(`>${s.country}<`)).toHaveLength(2);
  expect(page).toContain("finch@example.test");
  // Both can be ticked, approved and rejected one by one; the list pages by cursor.
  expect(page).toContain(s.select.replace("{name}", "wren"));
  expect(page).toContain(s.select.replace("{name}", "finch"));
  expect(page.split(s.approve).length).toBeGreaterThanOrEqual(3);
  expect(page).toContain(s.reject.summary);
  expect(page).toContain("cursor=next-page");
  // The queue is one request: nothing is read per row.
  expect(asked).toEqual(["/api/v1/admin/signups"]);
});

test("the paging links do not carry the result of the last decision", async () => {
  backend({ "member.approveRegistrations": true });
  const page = await html(
    SignupList({
      searchParams: Promise.resolve({
        decided: "approve",
        done: "2",
        skipped: "0",
        failed: "0",
        cursor: "c1",
      }),
    }),
  );
  expect(page).toContain("cursor=next-page");
  expect(page).not.toContain("decided=");
  expect(page).not.toContain("done=2");
});

test("a viewer who may not open the member's page or the address lookup gets plain names", async () => {
  backend({ "member.approveRegistrations": true });
  const page = await html(queue());
  expect(page).not.toContain("/admin/users/41");
  expect(page).not.toContain("/moderation/ips");
  expect(page).toContain("wren");
});

test("an empty queue says nobody is waiting", async () => {
  backend({ "member.approveRegistrations": true }, () =>
    Response.json({ items: [], nextCursor: null }),
  );
  const page = await html(queue());
  expect(page).toContain(messages.moderation.signups.emptyTitle);
});

test("a read the backend refuses reaches the panel's error screen as the backend's refusal, not as a crash of the list", async () => {
  backend({}, () =>
    Response.json(
      { error: { code: "forbidden", message: "You may not see sign-ups." } },
      { status: 403 },
    ),
  );
  const failure = await queue().then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(SermoError);
  expect((failure as SermoError).code).toBe("forbidden");
});

const result = (params: Record<string, string>) =>
  html(DecisionResult({ searchParams: Promise.resolve(params) }));

test("the result of a decision shows the counts and the reason for each account not changed", async () => {
  const page = await result({
    decided: "approve",
    done: "3",
    skipped: "1",
    failed: "1",
    lines: JSON.stringify([
      ["skipped", "robin", "Not waiting for approval any more."],
      ["failed", "#9", "The email could not be sent."],
    ]),
  });
  expect(page).toContain("3 sign-ups approved, 1 skipped, 1 failed.");
  expect(page).toContain("robin");
  expect(page).toContain("Not waiting for approval any more.");
  expect(page).toContain("The email could not be sent.");
  expect(page).toContain(messages.admin.memberOutcomes.status.skipped);
  expect(page).toContain(messages.admin.memberOutcomes.status.failed);
});

test("a decision that changed nobody is not drawn in the success colour", async () => {
  const none = await result({
    decided: "approve",
    done: "0",
    skipped: "2",
    failed: "0",
  });
  expect(none).toContain("text-muted-foreground");
  expect(none).not.toContain("text-success");
  const some = await result({
    decided: "approve",
    done: "2",
    skipped: "0",
    failed: "0",
  });
  expect(some).toContain("text-success");
});

test("a rejection says so, and lines left out of the address are counted", async () => {
  const page = await result({
    decided: "reject",
    done: "1",
    skipped: "3",
    failed: "0",
    lines: JSON.stringify([["skipped", "robin", "Outranks you."]]),
  });
  expect(page).toContain("1 sign-up rejected, 3 skipped");
  expect(page).toContain("2 more are not listed.");
});

test("an address that is not a well-formed result shows nothing, and text in it is shown as text", async () => {
  expect(await result({})).toBe("");
  expect(
    await result({ decided: "approve", done: "x", skipped: "0", failed: "0" }),
  ).toBe("");
  expect(
    await result({ decided: "delete", done: "1", skipped: "0", failed: "0" }),
  ).toBe("");
  const page = await result({
    decided: "approve",
    done: "0",
    skipped: "1",
    failed: "0",
    lines: JSON.stringify([
      ["skipped", "<b>x</b>", "<script>alert(1)</script>"],
    ]),
  });
  expect(page).not.toContain("<script>");
  expect(page).not.toContain("<b>x</b>");
  expect(page).toContain("&lt;script&gt;");
});
