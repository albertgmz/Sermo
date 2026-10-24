import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { siteBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
const intl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { HeaderLogo, SiteHeader } = await import("./site-header");

afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next-intl", () => intl);
  mock.module("next/cache", () => nextCache);
});
// Another test file leaves a stand-in for the viewer in place: the logo asks the backend.
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const picture = { fileId: 7, url: "/api/v1/files/7/logo.png" };

async function header(signedIn: boolean, logo: typeof picture | null) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(signedIn)),
    "site.get": () => Response.json(siteBody({ name: "Garden Club", logo })),
  });
  const stream = await renderToReadableStream(withIntl(await HeaderLogo()));
  await stream.allReady;
  return new Response(stream).text();
}

// The logo link that shows from `md` up (the phone's is the mark alone, for everyone).
const wide = (html: string) =>
  /<a[^>]*class="[^"]*hidden md:inline-flex[^"]*"[^>]*>.*?<\/a>/.exec(
    html,
  )?.[0] ?? "";

test("a guest's header keeps the logo with its name between md and lg, as before", async () => {
  const html = wide(await header(false, null));
  expect(html).toContain("<span>Garden Club</span>");
  expect(html).not.toContain("max-lg:");
});

test("a member's drawn logo shows its mark alone between md and lg, and its name from lg", async () => {
  const html = wide(await header(true, null));
  expect(html).toMatch(/class="[^"]*max-lg:w-10[^"]*max-lg:justify-center/);
  expect(html).toContain('<span class="max-lg:hidden">Garden Club</span>');
});

test("a member's picture logo is capped, not squeezed to a mark, between md and lg", async () => {
  const html = wide(await header(true, picture));
  expect(html).toMatch(
    /<img[^>]*class="h-6 w-auto max-w-40 object-contain object-left max-lg:max-w-18"/,
  );
  expect(html).not.toContain("max-lg:w-10");
  // A guest's picture is as it was.
  const guest = wide(await header(false, picture));
  expect(guest).toMatch(
    /<img[^>]*class="h-6 w-auto max-w-40 object-contain object-left"/,
  );
});

test("the header sticks to the top of the window, opaque and above the page", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "site.get": () => Response.json(siteBody({ name: "Garden Club" })),
    "navigation.get": () =>
      Response.json({ header: [], mobile: [], account: [], footer: [] }),
  });
  const stream = await renderToReadableStream(withIntl(<SiteHeader />));
  const html = await new Response(stream).text();
  const tag = /<header[^>]*>/.exec(html)?.[0] ?? "";
  const classes = /class="([^"]*)"/.exec(tag)?.[1].split(" ") ?? [];
  for (const name of ["sticky", "top-0", "z-30", "bg-background"]) {
    expect(classes).toContain(name);
  }
});

test("the header has no narrow-page button: it lives in the footer", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "site.get": () => Response.json(siteBody({ name: "Garden Club" })),
    "navigation.get": () =>
      Response.json({ header: [], mobile: [], account: [], footer: [] }),
  });
  const stream = await renderToReadableStream(withIntl(<SiteHeader />));
  const html = await new Response(stream).text();
  expect(html).not.toContain("narrower page");
  expect(html).not.toContain("aria-pressed");
});
