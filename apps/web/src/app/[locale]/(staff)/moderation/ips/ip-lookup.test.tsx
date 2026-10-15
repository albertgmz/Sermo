import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const intl = await import("next-intl/server");
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
  getTranslations: async (namespace: string) => {
    const t = (key: string, values?: Record<string, string | number>) => {
      let value: unknown = messages;
      for (const part of `${namespace}.${key}`.split(".")) {
        value = (value as Record<string, unknown> | undefined)?.[part];
      }
      if (typeof value !== "string") return key;
      return value.replace(/\{(\w+)\}/g, (whole, name: string) =>
        values && name in values ? String(values[name]) : whole,
      );
    };
    return Object.assign(t, { has: (key: string) => t(key) !== key });
  },
}));

const { IpLookup } = await import("./ip-lookup");
const { ContentIp } = await import("@/components/staff/content-ip");

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const at = "2026-01-01T00:00:00.000Z";
const later = "2026-02-01T00:00:00.000Z";
const device = {
  browser: "Chrome",
  os: "Windows",
  deviceType: "desktop",
  brand: null,
  model: null,
  isBot: false,
};

// A backend that answers the three IP reads and says what it was asked.
function backend(holdsViewIps = true) {
  const asked: URL[] = [];
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/api/v1/me") {
      const viewer = viewerBody(true);
      return Response.json({
        ...viewer,
        resolvedPermissions: { "member.viewIps": holdsViewIps },
        staff: { ...viewer.staff, panel: true },
      });
    }
    asked.push(url);
    if (url.pathname === "/api/v1/admin/users/4/ips") {
      return Response.json({
        items: [
          {
            ip: "2001:db8:0:1::5",
            network: "2001:db8:0:1::/64",
            count: 3,
            firstSeenAt: at,
            lastSeenAt: later,
          },
          {
            ip: "203.0.113.7",
            network: "203.0.113.7",
            count: 1,
            firstSeenAt: at,
            lastSeenAt: at,
          },
        ],
        nextCursor: null,
      });
    }
    if (url.pathname === "/api/v1/admin/ips/members") {
      if (url.searchParams.get("ip") === "nonsense") {
        return Response.json(
          { error: { code: "validation", message: "Enter an address." } },
          { status: 400 },
        );
      }
      return Response.json({
        network: "2001:db8:0:1::/64",
        items: [
          {
            user: { id: 4, username: "Wren" },
            count: 2,
            firstSeenAt: at,
            lastSeenAt: later,
          },
        ],
        nextCursor: null,
      });
    }
    if (url.pathname === "/api/v1/admin/ips/content") {
      return Response.json({
        entry: {
          userId: 4,
          ip: "203.0.113.7",
          action: "post",
          createdAt: at,
          device,
        },
      });
    }
    if (url.pathname === "/api/v1/member-cards") {
      return Response.json({ items: [] });
    }
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

const search = (params: Record<string, string>) =>
  Promise.resolve(params as Record<string, string | undefined>);

test("a member's addresses are listed with counts and first and last seen, each linking to who shares it", async () => {
  const asked = backend();
  const page = await html(IpLookup({ searchParams: search({ member: "4" }) }));
  expect(
    asked.some((url) => url.pathname === "/api/v1/admin/users/4/ips"),
  ).toBe(true);
  expect(page).toContain("2001:db8:0:1::5");
  expect(page).toContain("203.0.113.7");
  expect(page).toContain(
    `href="/moderation/ips?ip=${encodeURIComponent("2001:db8:0:1::5")}"`,
  );
  expect(page).toContain("Addresses used by #4");
  expect(page).toContain("network 2001:db8:0:1::/64");
  expect(page).toContain("2026");
});

test("an address lists the members who used it, with the network the backend matched", async () => {
  const asked = backend();
  const page = await html(
    IpLookup({ searchParams: search({ ip: "2001:db8:0:1::99" }) }),
  );
  expect(
    asked.find((url) => url.pathname.endsWith("/ips/members"))?.search,
  ).toContain("ip=2001%3Adb8%3A0%3A1%3A%3A99");
  expect(page).toContain("Members who used 2001:db8:0:1::/64");
  expect(page).toContain("Wren");
  expect(page).toContain('href="/moderation/ips?member=4"');
});

test("a value that is not an address is told so, and no address shows the search form alone", async () => {
  backend();
  const refused = await html(
    IpLookup({ searchParams: search({ ip: "nonsense" }) }),
  );
  expect(refused).toContain(messages.moderation.ips.invalid);
  const empty = await html(IpLookup({ searchParams: search({}) }));
  expect(empty).toContain('name="ip"');
  expect(empty).not.toContain("Members who used");
});

test("content shows its address to a holder of View IPs and nothing to anyone else", async () => {
  const asked = backend(true);
  const shown = await html(ContentIp({ from: { type: "post", id: 12 } }));
  expect(shown).toContain("203.0.113.7");
  expect(shown).toContain(`href="/moderation/ips?ip=203.0.113.7"`);
  expect(
    asked.find((url) => url.pathname.endsWith("/ips/content"))?.search,
  ).toBe("?contentType=post&contentId=12");
  const hidden = backend(false);
  expect(await html(ContentIp({ from: { type: "post", id: 12 } }))).toBe("");
  expect(hidden.some((url) => url.pathname.endsWith("/ips/content"))).toBe(
    false,
  );
  expect(await html(ContentIp({ from: null }))).toBe("");
});
