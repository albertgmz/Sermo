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
const { AccountTools, HeaderLogo, MenuNavigation, SiteHeader } = await import(
  "./site-header"
);

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

// Members start a thread from the forum's own New thread button; the round + of the phone's
// bottom bar (`mobile-nav.tsx`) is the one Create entry left.
test("the header has no Create control, for a member or for a guest", async () => {
  for (const signedIn of [true, false]) {
    backend = fakeBackend({
      "auth.me": () => Response.json(viewerBody(signedIn)),
      "site.get": () => Response.json(siteBody({ name: "Garden Club" })),
      "users.cards": () => Response.json({ items: [] }),
    });
    const stream = await renderToReadableStream(withIntl(await AccountTools()));
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html, String(signedIn)).not.toContain('aria-label="Create"');
    expect(html, String(signedIn)).not.toContain('aria-haspopup="dialog"');
    backend.restore();
  }
});

async function tools(signedIn: boolean, registrationOpen = true) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(signedIn)),
    "site.get": () =>
      Response.json(
        siteBody({
          name: "Garden Club",
          registration: {
            open: registrationOpen,
            approval: false,
            minimumAge: 0,
            fields: [],
          },
        }),
      ),
    "users.cards": () => Response.json({ items: [] }),
    "navigation.get": () =>
      Response.json({ header: [], mobile: [], account: [], footer: [] }),
  });
  const stream = await renderToReadableStream(withIntl(await AccountTools()));
  await stream.allReady;
  return new Response(stream).text();
}

const anchor = (html: string, href: string) =>
  new RegExp(`<a[^>]*href="${href}"[^>]*>`).exec(html)?.[0] ?? "";

test("on a phone a guest's top bar has no Log in button and no options gear, and keeps Create Account", async () => {
  const html = await tools(false);
  expect(anchor(html, "/login")).toContain("max-md:hidden");
  // The gear sits in a box that is gone below md and has no box of its own from md up.
  expect(html).toMatch(
    /<span class="hidden md:contents"><button[^>]*aria-label="Site options"/,
  );
  const register = anchor(html, "/register");
  expect(register).not.toBe("");
  expect(register).not.toContain("hidden");
});

test("a guest's header keeps its Log in button and gear from md up", async () => {
  const html = await tools(false);
  expect(anchor(html, "/login")).not.toMatch(/(^|[ "])hidden/);
  expect(html).toContain('aria-label="Site options"');
});

test("a guest's top bar has no Create Account button once registration is closed", async () => {
  const html = await tools(false, false);
  expect(anchor(html, "/register")).toBe("");
  expect(anchor(html, "/login")).not.toBe("");
});

test("a member's top bar has no guest controls, on a phone or on a wide screen", async () => {
  const html = await tools(true);
  expect(html).not.toContain("data-guest-tools");
  expect(html).not.toContain('aria-label="Site options"');
  expect(anchor(html, "/login")).toBe("");
  expect(anchor(html, "/register")).toBe("");
});

async function menuProps(signedIn: boolean) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(signedIn)),
    "navigation.get": () =>
      Response.json({ header: [], mobile: [], account: [], footer: [] }),
  });
  const element = (await MenuNavigation()) as {
    props: { dataSaver?: unknown };
  };
  return element.props;
}

test("the hamburger menu carries the Data saver for a guest and not for a member", async () => {
  expect((await menuProps(false)).dataSaver).toBeDefined();
  backend?.restore();
  expect((await menuProps(true)).dataSaver).toBeUndefined();
});
