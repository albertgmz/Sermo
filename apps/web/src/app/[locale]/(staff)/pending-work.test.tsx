import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getFormatter: async () => ({ number: (value: number) => String(value) }),
  getTranslations: async (namespace: string) => translator(namespace, true),
}));

const { PendingWork } = await import("./pending-work");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const queue = (count: number, more = false) => ({ count, more, cap: 99 });

function backend(held: Record<string, boolean>) {
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
    if (pathname === "/api/v1/me/counters") {
      return Response.json({
        notifications: 0,
        conversations: 0,
        openReports: queue(2),
        pendingApprovals: queue(4),
        pendingSignups: queue(3),
      });
    }
    return Response.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function draw() {
  const element = await PendingWork({});
  return element ? renderToStaticMarkup(withIntl(element)) : "";
}

const p = messages.admin.homePending;

test("the sign-up tile shows the waiting count and links to the queue for a viewer who may open it", async () => {
  backend({ "member.approveRegistrations": true });
  const html = await draw();
  expect(html).toContain(p.signups);
  expect(html).toContain(">3<");
  expect(html).toContain('href="/moderation/signups"');
  // The other queues are not theirs: no tile for them.
  expect(html).not.toContain(p.reports);
  expect(html).not.toContain(p.approvals);
});

test("a viewer who may not open the queue sees no tile for it, whatever the counters say", async () => {
  backend({ "admin.settings": true });
  expect(await draw()).toBe("");
});

test("a moderator who also holds the permission sees all three tiles", async () => {
  backend({
    "member.approveRegistrations": true,
    "report.manageProfiles": true,
  });
  const html = await draw();
  expect(html).toContain(p.reports);
  expect(html).toContain(p.signups);
});
