import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { NextRequest, type NextResponse } from "next/server";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { messages } from "../src/i18n/messages";
import { DEFAULT_ICON_URL } from "../src/lib/default-icon";
import { LITE_CATEGORIES, LITE_COOKIE } from "../src/lib/lite-preferences";
import { siteBody } from "../src/lib/test-bodies";
import { IMAGE_EXTENSIONS, read } from "./lite-scan";

// Mock only the missing server environment and data boundary. The real cookie
// parser, server LITE helpers, proxy, gates and React renderer run unchanged.
let cookie: string | undefined;
const storedSignature =
  "Shop: [IMG]https://pictures.test/l.png[/IMG] <video> demo below\nline two";
mock.module("server-only", () => ({}));
const nextHeaders = { ...(await import("next/headers")) };
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === LITE_COOKIE && cookie !== undefined
        ? { name, value: cookie }
        : undefined,
    toString: () => (cookie === undefined ? "" : `${LITE_COOKIE}=${cookie}`),
  }),
  headers: async () => new Headers(),
}));
// Components read their text from the message files; outside a request there
// is no provider, so resolve keys straight from the same files.
function translator(namespace: string) {
  const t = (key: string) => {
    let value: unknown = messages;
    for (const part of `${namespace}.${key}`.split(".")) {
      value = (value as Record<string, unknown> | undefined)?.[part];
    }
    return typeof value === "string" ? value : key;
  };
  return Object.assign(t, { rich: t });
}
// A stand-in for one hook keeps the other exports of the library, so a module that imports
// another of them still links after this suite has run.
// Copies of what the stand-ins replace, put back once the suite is done (a module namespace takes a
// stand-in's exports once it is replaced, so it cannot be put back itself).
const realIntl = { ...(await import("next-intl")) };
const realServer = { ...(await import("next-intl/server")) };
const realViewer = { ...(await import("@/lib/sermo/viewer")) };
const realAccountData = {
  ...(await import("@/app/[locale]/(main)/account/data")),
};
const realFetch = globalThis.fetch;
mock.module("next-intl", () => ({
  ...realIntl,
  useLocale: () => "en",
  useTranslations: translator,
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getFormatter: async () => ({ dateTime: () => "" }),
  getTranslations: async (namespace: string) => translator(namespace),
}));
// The signed-in account comes from the backend; the viewer value is the session token.
mock.module("@/lib/sermo/viewer", () => ({
  viewerOf: async (headers: Headers) => {
    const token = /sermo\.session_token=(\d+)/.exec(
      headers.get("cookie") ?? "",
    )?.[1];
    return token
      ? {
          user: { username: `member${token}` },
          resolvedPermissions: {},
          staff: {
            panel: token === "102",
            moderatesEverywhere: false,
            moderatedNodeIds: [],
          },
        }
      : null;
  },
}));
// The site comes from the backend; tests choose which identity pictures it has.
let site: {
  name: string;
  logo: { fileId: number; url: string } | null;
  icon: { fileId: number; url: string } | null;
  backdrop: { fileId: number; url: string } | null;
} = { name: "Sermo", logo: null, icon: null, backdrop: null };
const nextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
const member = { id: 1, username: "ember" };
// The one conversation the backend knows, as conversations.get answers.
const conversation = {
  id: 101,
  title: "Seed swap",
  starter: member,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastMessage: {
    messageId: 1,
    sentAt: "2026-01-01T00:00:00.000Z",
    user: member,
  },
  messageCount: 1,
  participantCount: 1,
  isUnread: false,
  pollKind: null,
  participants: [{ user: member, state: "active" }],
  canReply: true,
  canInvite: false,
  canRename: false,
  isLocked: false,
  canLock: false,
};
// Forums, threads, members, conversations and awards are asked of the backend, which knows only
// record 101.
globalThis.fetch = (async (input: string) => {
  const record =
    /\/api\/v1\/(?:seo\/)?(?:nodes|threads|users|conversations|awards)\/(\d+)/.exec(
      String(input),
    );
  if (record && Number(record[1]) !== 101) {
    return Response.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }
  if (String(input).endsWith("/conversations/101")) {
    return Response.json(conversation);
  }
  return Response.json({
    ...site,
    ...siteBody(),
    ...site,
  });
}) as unknown as typeof fetch;
// The member as they edit their own profile.
mock.module("@/app/[locale]/(main)/account/data", () => ({
  getSelf: async () => ({
    may: { setCustomTitle: false, setSignature: true },
    limits: {
      signatureMaxLength: 500,
      signatureMaxLines: 4,
      signatureMaxLinks: 3,
      signatureMaxImages: 1,
      signatureMaxSmilies: 5,
      signatureMaxTextSize: 4,
      signatureFormats: ["bold", "link"],
      customTitleMaxLength: 40,
    },
    signatureNeeds: null,
    profile: { username: "member1" },
    usernameChange: { reason: null, availableAt: null },
    customTitle: null,
    signatureSource: storedSignature,
  }),
  getWorn: async () => ({}),
  getRenameUnits: async () => 0,
  shopHref: "/credits",
}));
afterAll(() => {
  mock.module("next-intl", () => realIntl);
  mock.module("next-intl/server", () => realServer);
  mock.module("@/lib/sermo/viewer", () => realViewer);
  mock.module("next/cache", () => nextCache);
  mock.module("next/headers", () => nextHeaders);
  mock.module("@/app/[locale]/(main)/account/data", () => realAccountData);
  globalThis.fetch = realFetch;
});
// Dynamic imports ensure mocks are installed before the server modules load.
const { proxy, config } = await import("../src/proxy");
const { Art, LazyArt } = await import("../src/components/forum/art");
const { UserAvatar } = await import("../src/components/forum/user-avatar");
const { AwardIcon } = await import("../src/components/forum/award-icon");
const { ShopIcon } = await import("../src/components/forum/shop-icon");
const { HtmlContent } = await import("../src/components/forum/html-content");
const { SiteIcon } = await import("../src/components/layout/site-icon");
const { LogoMark } = await import("../src/components/layout/logo");
const { PageBackdrop } = await import("../src/components/layout/page-backdrop");
const { SignatureHtml } = await import(
  "../src/components/forum/signature-html"
);
const { TitleSection } = await import(
  "../src/app/[locale]/(main)/account/profile-forms"
);
const { EditorDemo } = await import(
  "../src/app/[locale]/(main)/ui/editor-demo"
);

afterEach(() => {
  cookie = undefined;
});

function request(path: string, lite?: string, viewer?: string, method = "GET") {
  const value = new NextRequest(`https://forum.test${path}`, { method });
  if (lite !== undefined) value.cookies.set(LITE_COOKIE, lite);
  if (viewer !== undefined) value.cookies.set("sermo.session_token", viewer);
  return value;
}

async function placeholder(
  response: NextResponse | undefined,
  context: string,
) {
  expect(response, context).toBeDefined();
  if (!response) throw new Error(`${context}: expected a LITE placeholder`);
  expect(response.status, context).toBe(200);
  expect(response.headers.get("content-type"), context).toBe("image/svg+xml");
  expect(response.headers.get("cache-control"), context).toBe("no-store");
  expect(response.headers.get("x-middleware-next"), context).toBe(null);
  const body = await response.text();
  expect(body, context).toMatch(
    /^<svg\b[^>]*><text\b[^>]*>DATA SAVER<\/text><\/svg>$/,
  );
  expect(body, context).not.toMatch(
    /<path\b|<image\b|\bhref=|data:image|url\(/,
  );
}

function passThrough(response: NextResponse | undefined, context: string) {
  if (!response) return;
  // Next's own addresses go on as they are; a page is rewritten to the language segment.
  if (response.headers.get("x-middleware-next") === "1") return;
  const rewrite = response.headers.get("x-middleware-rewrite") ?? "";
  expect(new URL(rewrite).pathname, context).toMatch(/^\/(en|es)(\/|$)/);
  expect(rewrite, context).not.toContain("/not-found");
  expect(response.headers.get("location"), context).toBe(null);
  expect(response.headers.get("content-type"), context).toBe(null);
}

// The backend serves every picture, so nothing in `public` is one and no category owns a path. These
// stand for any picture file that is put in front of the proxy all the same.
const PICTURES = [
  "/pictures/photo.jpg",
  "/media/ring.png",
  "/mark.svg",
  "/a/b/c.webp",
];

test("proxy replaces every picture path for master/legacy cookies and, without a cookie, answers each as an address no page has", async () => {
  for (const path of PICTURES) {
    for (const master of ["all", "1"])
      await placeholder(
        await proxy(request(path, master)),
        `${path} (${master})`,
      );
    notFound(await proxy(request(path)), path);
  }
});

for (const { key } of LITE_CATEGORIES) {
  test(`proxy replaces a picture path that no category owns when only ${key} is selected`, async () => {
    for (const path of PICTURES)
      await placeholder(await proxy(request(path, key)), `${key}: ${path}`);
  });
}

test("proxy blocks encoded, Windows, case, slash and dot aliases of every picture path", async () => {
  for (const path of PICTURES) {
    const aliases = [
      path.replace(
        /[a-z]/gi,
        (letter) => `%${letter.charCodeAt(0).toString(16)}`,
      ),
      path.replaceAll(".", "%2E"),
      path.replaceAll("/", "%5C").replace(/^%5C/, "/"),
      `/%2F${path.slice(1).replaceAll("/", "%2F")}`,
      path.replaceAll("/", "//"),
      `${path}/`,
      `${path}%2F`,
      `${path}.`,
      `${path}..`,
      `${path}%20`,
      `${path}. .`,
      `/discard/..${path}`,
      `/discard%2F..%2F${path.slice(1)}`,
      `/./${path.slice(1)}`,
      path.toUpperCase(),
    ];
    for (const alias of aliases)
      await placeholder(await proxy(request(alias, "all")), alias);
  }
  for (const extension of IMAGE_EXTENSIONS)
    for (const suffix of [extension, extension.toUpperCase()])
      await placeholder(
        await proxy(request(`/unregistered/picture.${suffix}`, "all")),
        suffix,
      );
});

function notFound(response: NextResponse | undefined, context: string) {
  expect(response?.status, context).toBe(404);
  expect(response?.headers.get("x-middleware-rewrite"), context).toBe(
    "https://forum.test/en/not-found",
  );
  expect(response?.headers.get("content-type"), context).toBe(null);
}

test("unsafe paths outside every picture folder are real 404s for every visitor", async () => {
  for (const path of ["/foo:bar", "/foo~1/bar", "/x/y~2", "/a:b/c.html"])
    for (const mode of [undefined, "all", "avatars"])
      notFound(await proxy(request(path, mode)), `${mode}: ${path}`);
  // A short name that ends in a picture suffix is a picture request like any other.
  for (const mode of ["all", "threadCovers"])
    await placeholder(
      await proxy(request("/THREAD~1/vinyl.jpg", mode)),
      `${mode}: short name`,
    );
});

test("picture-looking paths inside page namespaces answer with a 404, not a placeholder", async () => {
  for (const path of [
    "/forums/abc.gif",
    "/awards/1.avif",
    "/awards/1.avif.",
    "/forums/missing.gif%20",
    "/forums/1.gif::$DATA",
  ])
    for (const mode of [undefined, "all", "forumArt", "awards"])
      notFound(await proxy(request(path, mode)), `${mode}: ${path}`);
});

test("malformed encoding never throws and recognized image suffixes stay blocked", async () => {
  for (const path of [
    "/bad%/picture.png",
    "/bad%GG/picture.png",
    "/%E0%A4%A/picture.png",
    "/%FF/picture.png",
  ])
    await placeholder(await proxy(request(path, "all")), path);
  for (const path of ["/bad%", "/%GG", "/%E0%A4%A", "/picture.%FF"])
    for (const mode of [undefined, "all"]) await proxy(request(path, mode));
});

test("optimizer requests are disabled in config and also blocked by LITE; matcher includes images", async () => {
  expect(read("next.config.ts")).toMatch(
    /images\s*:\s*\{\s*unoptimized\s*:\s*true\b/,
  );
  // Every path, images included, except the picture upload: the proxy would copy its body.
  expect(config.matcher).toHaveLength(1);
  const matches = (path: string) =>
    new RegExp(`^${config.matcher[0]}$`).test(path);
  for (const path of [
    "/",
    "/_next/image",
    "/pictures/test.jpg",
    "/account",
    "/account/pictures",
    "/account/picture/extra",
    "/threads/1",
  ])
    expect(matches(path), path).toBe(true);
  expect(matches("/account/picture")).toBe(false);
  expect(matches("/threads/12/uploads")).toBe(false);
  expect(matches("/threads/12/uploads/x")).toBe(true);
  expect(matches("/attachments")).toBe(false);
  expect(matches("/attachments/x")).toBe(true);
  expect(matches("/admin/uploads")).toBe(false);
  expect(matches("/admin/uploads/x")).toBe(true);
  expect(matches("/admin/forums")).toBe(true);
  expect(matches("/threads/12")).toBe(true);
  for (const path of [
    "/_next/image?url=%2Fpictures%2Ftest.jpg&w=640&q=75",
    "/_next/image?url=https%3A%2F%2Fpictures.test%2Fx.png&w=640&q=75",
  ])
    for (const mode of ["all", ...LITE_CATEGORIES.map(({ key }) => key)])
      await placeholder(await proxy(request(path, mode)), `${mode}: ${path}`);
  passThrough(
    await proxy(request("/_next/image?url=%2Fpictures%2Fx.jpg")),
    "optimizer without cookie",
  );
  passThrough(
    await proxy(request("/_next/static/app.js", "all")),
    "/_next/static/app.js",
  );
  // No page has these (the matcher keeps the backend's robots.txt away from the proxy): they are the
  // 404, never a placeholder.
  for (const path of ["/styles.css", "/robots.txt"])
    notFound(await proxy(request(path, "all")), path);
});

test("LITE retains guest redirects, admin protection and unknown-id 404s", async () => {
  for (const mode of [undefined, "all", "avatars"]) {
    const guest = await proxy(request("/account", mode));
    expect(guest?.status).toBe(307);
    expect(guest?.headers.get("location")).toBe(
      "https://forum.test/login?next=%2Faccount",
    );
    for (const viewer of [undefined, "101"]) {
      const denied = await proxy(request("/admin", mode, viewer));
      expect(denied?.status).toBe(404);
      expect(denied?.headers.get("x-middleware-rewrite")).toBe(
        "https://forum.test/en/not-found",
      );
    }
    passThrough(await proxy(request("/admin", mode, "102")), "admin");
    passThrough(
      await proxy(request("/account", mode, "101")),
      "member account",
    );
    for (const section of [
      "members",
      "forums",
      "awards",
      "threads",
      "conversations",
    ]) {
      passThrough(
        await proxy(request(`/${section}/101`, mode, "101")),
        section,
      );
      for (const id of [
        "999999",
        "0",
        "-1",
        "word",
        "1.2",
        "9007199254740992",
      ]) {
        const response = await proxy(request(`/${section}/${id}`, mode, "101"));
        expect(response?.status, `${section}/${id}`).toBe(404);
        expect(response?.headers.get("x-middleware-rewrite")).toBe(
          "https://forum.test/en/not-found",
        );
      }
    }
  }
});

test("legacy GET migration preserves image blocking and access redirects", async () => {
  for (const path of ["/", "/account", "/pictures/test.jpg"]) {
    const response = await proxy(request(path, "1"));
    expect(response?.cookies.get(LITE_COOKIE)?.value).toBe("all");
    const header = response?.headers.get("set-cookie") ?? "";
    expect(header).not.toContain("HttpOnly");
    expect(header).toContain("Path=/");
    expect(header).toContain("SameSite=lax");
  }
  const post = await proxy(
    request("/pictures/test.jpg", "1", undefined, "POST"),
  );
  expect(post?.headers.get("set-cookie")).toBe(null);
  await placeholder(post, "legacy POST image");
});

async function editorValue(defaultValue: string) {
  const element = await EditorDemo({ defaultValue });
  return { value: element.props.defaultValue as string };
}

async function markup(node: ReactNode) {
  // Wait for all Suspense boundaries; renderToStaticMarkup alone hides async
  // children behind fallbacks and would give a false positive for blocked art.
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

function noArtwork(html: string) {
  expect(html).not.toMatch(
    /pictures\.test|<img\b|<image\b|<path\b|\sd=|url\(|data:image/,
  );
}

function rootClasses(html: string) {
  const root = html.replace(/^(?:<link\b[^>]*>|<!--[\s\S]*?-->)+/, "");
  return root.match(/^<[^>]*\bclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
}

test("Art blocks every category before emitting its URL and preserves caller sizing", async () => {
  const sizing = "absolute inset-0 h-28 w-full aspect-video rounded-md";
  for (const { key } of LITE_CATEGORIES) {
    const props = {
      src: "https://pictures.test/private.png",
      category: key,
      className: sizing,
    };
    cookie = undefined;
    const visible = renderToStaticMarkup(await Art(props));
    expect(visible).toContain(props.src);
    for (const mode of [key, "all"]) {
      cookie = mode;
      const hidden = renderToStaticMarkup(await Art(props));
      noArtwork(hidden);
      expect(hidden).toContain("DATA SAVER");
      for (const token of sizing.split(" ")) {
        expect(rootClasses(hidden)).toContain(token);
        expect(rootClasses(visible)).toContain(token);
      }
    }
    cookie = LITE_CATEGORIES.find(({ key: other }) => other !== key)?.key;
    expect(renderToStaticMarkup(await Art(props))).toContain(props.src);
  }
});

test("LazyArt names a picture's smaller copies only when it draws the picture", async () => {
  const props = {
    src: "https://pictures.test/poll.png",
    candidates:
      "https://pictures.test/poll-640.webp 640w, https://pictures.test/poll.png 1000w",
    sizes: "auto, 100vw",
    category: "postImages" as const,
    className: "aspect-video w-full",
  };
  cookie = undefined;
  const visible = renderToStaticMarkup(await LazyArt(props));
  expect(visible).toContain(`srcSet="${props.candidates}"`);
  expect(visible).toContain('sizes="auto, 100vw"');
  expect(visible).toContain('loading="lazy"');
  // Without copies it is the one picture, with no sizes to go by.
  const single = renderToStaticMarkup(
    await LazyArt({ ...props, candidates: null }),
  );
  expect(single).not.toContain("srcSet");
  expect(single).not.toContain("sizes=");
  for (const mode of ["postImages", "all"]) {
    cookie = mode;
    const hidden = renderToStaticMarkup(await LazyArt(props));
    noArtwork(hidden);
    expect(hidden).not.toContain("srcSet");
    expect(hidden).not.toContain("poll-640");
  }
});

test("avatar and frame gates are independent and preserve the outer box at every size", async () => {
  const frame = {
    url: "https://pictures.test/frame.png",
    placement: { width: 170.5, left: -33.2, top: -30.1, scale: 92 },
  };
  const user = {
    username: "Example",
    avatar: {
      url: "https://pictures.test/avatar.jpg",
      smallUrl: "https://pictures.test/avatar-small.jpg",
    },
    frame,
  };
  for (const size of ["xs", "sm", "md", "lg", "xl", "2xl", "sm-lg"] as const) {
    cookie = undefined;
    const visible = renderToStaticMarkup(
      await UserAvatar({ user, size, link: false }),
    );
    // Lists draw the small rendition, the large sizes the full picture.
    const drawn = ["xl", "2xl"].includes(size)
      ? user.avatar.url
      : user.avatar.smallUrl;
    expect(visible).toContain(drawn);
    cookie = "all";
    const hidden = renderToStaticMarkup(
      await UserAvatar({ user, size, link: false }),
    );
    noArtwork(hidden);
    // The placeholder's word shows only where the box has room for it: never at 20 or 24 px, from
    // md up for the avatar that is 24 px on a phone and 40 px there.
    const label = /<span class="([^"]*)">Data saver<\/span>/i.exec(hidden);
    expect(label?.[1], size).toBe(
      size === "xs" || size === "sm"
        ? "sr-only"
        : size === "sm-lg"
          ? "max-md:sr-only"
          : "",
    );
    const sizeClasses = rootClasses(visible).filter((value) =>
      /^(?:size-|shrink-|relative$)/.test(value),
    );
    expect(sizeClasses.length).toBeGreaterThan(0);
    for (const token of sizeClasses)
      expect(rootClasses(hidden)).toContain(token);
  }
  cookie = "avatars";
  const frameOnly = renderToStaticMarkup(
    await UserAvatar({ user, link: false }),
  );
  expect(frameOnly).not.toContain(user.avatar.smallUrl);
  expect(frameOnly).toContain(frame.url);
  cookie = "frames";
  const avatarOnly = renderToStaticMarkup(
    await UserAvatar({ user, link: false }),
  );
  expect(avatarOnly).toContain(user.avatar.smallUrl);
  expect(avatarOnly).not.toContain(frame.url);
  // Whatever is hidden, what remains keeps the inner scale the frame gave it.
  const scale = `scale:${frame.placement.scale / 100}`;
  expect(frameOnly).toContain(scale);
  expect(avatarOnly).toContain(scale);
  expect(avatarOnly).toContain("after:hidden");
  expect(frameOnly).toContain("after:hidden");
  cookie = "avatars.frames";
  expect(
    renderToStaticMarkup(await UserAvatar({ user, link: false })),
  ).toContain(scale);
});

test("inline award, shop, logo and backdrop artwork disappears with its category", async () => {
  const cases = [
    {
      category: "awards",
      draw: async () =>
        await AwardIcon({
          award: { name: "Example", icon: "trophy", tier: "gold" },
          className: "size-12",
        }),
    },
    {
      category: "shop",
      draw: async () => await ShopIcon({ type: "frame", className: "size-12" }),
    },
    {
      category: "brand",
      draw: async () => createElement(LogoMark, { className: "size-12" }),
    },
    { category: "brand", draw: async () => createElement(PageBackdrop) },
  ];
  for (const { category, draw } of cases) {
    cookie = undefined;
    const visible = await markup(await draw());
    expect(visible, category).toContain("<svg");
    for (const mode of [category, "all"]) {
      cookie = mode;
      const hidden = await markup(await draw());
      noArtwork(hidden);
      expect(hidden, category).not.toContain("<svg");
      const sizing = rootClasses(visible).filter((token) =>
        /^(?:size-|h-|w-|inset-|inset-x-|top-|absolute$)/.test(token),
      );
      expect(sizing.length, category).toBeGreaterThan(0);
      for (const token of sizing)
        expect(rootClasses(hidden), category).toContain(token);
    }
    cookie = category === "brand" ? "awards" : "brand";
    expect(await markup(await draw())).toContain("<svg");
  }
});

test("site icon URL is absent when brand is blocked", async () => {
  for (const mode of [undefined, "avatars", "brand", "all"]) {
    cookie = mode;
    const html = renderToStaticMarkup(await SiteIcon());
    if (mode === "brand" || mode === "all") noArtwork(html);
    else expect(html).toContain('rel="icon" href="data:image/svg+xml,');
  }
});

// The links of an icon, each as its attributes.
const iconLinks = (html: string) =>
  [...html.matchAll(/<link ([^>]*?)\/?>/g)].map(([, attributes]) =>
    Object.fromEntries(
      [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [
        name,
        value,
      ]),
    ),
  );

test("the site icon links: the ICO, the drawn mark at any size and the iOS icon, or the uploaded icon for both", async () => {
  cookie = undefined;
  expect(iconLinks(renderToStaticMarkup(await SiteIcon()))).toEqual([
    { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
    {
      rel: "icon",
      href: DEFAULT_ICON_URL,
      type: "image/svg+xml",
      sizes: "any",
    },
    { rel: "apple-touch-icon", href: "/pwa-icon/180", sizes: "180x180" },
  ]);
  site = { ...site, icon: { fileId: 6, url: "/api/v1/files/6" } };
  try {
    expect(iconLinks(renderToStaticMarkup(await SiteIcon()))).toEqual([
      { rel: "icon", href: "/api/v1/files/6", type: "image/png" },
      { rel: "apple-touch-icon", href: "/api/v1/files/6" },
    ]);
  } finally {
    site = { name: "Sermo", logo: null, icon: null, backdrop: null };
  }
});

test("backend identity pictures are absent from the page when brand is blocked", async () => {
  site = {
    name: "Garden Club",
    logo: { fileId: 5, url: "/api/v1/files/5" },
    icon: { fileId: 6, url: "/api/v1/files/6" },
    backdrop: { fileId: 7, url: "/api/v1/files/7" },
  };
  try {
    const draws = [
      {
        // The square mark is the icon when there is one.
        element: createElement(LogoMark, { className: "size-12" }),
        url: "/api/v1/files/6",
      },
      {
        element: createElement(PageBackdrop, { key: "backdrop" }),
        url: "/api/v1/files/7",
      },
    ];
    for (const mode of [undefined, "awards", "brand", "all"]) {
      cookie = mode;
      const blocked = mode === "brand" || mode === "all";
      for (const { element, url } of draws) {
        const html = await markup(element);
        if (blocked) noArtwork(html);
        else expect(html).toContain(url);
        expect(html.includes(url)).toBe(!blocked);
      }
      const icon = renderToStaticMarkup(await SiteIcon());
      expect(icon.includes("/api/v1/files/6")).toBe(!blocked);
      expect(icon).not.toContain("data:image");
    }
  } finally {
    site = { name: "Sermo", logo: null, icon: null, backdrop: null };
  }
});

test("the square mark falls back to the logo when the site has no icon", async () => {
  site = {
    name: "Garden Club",
    logo: { fileId: 5, url: "/api/v1/files/5" },
    icon: null,
    backdrop: null,
  };
  try {
    cookie = undefined;
    expect(await markup(createElement(LogoMark))).toContain("/api/v1/files/5");
  } finally {
    site = { name: "Sermo", logo: null, icon: null, backdrop: null };
  }
});

test("stored HTML gates external images while preserving links and its root box", async () => {
  const body =
    '<p>Before <a href="/destination"><img src="https://pictures.test/photo.jpg" alt="image"></a> after.</p>';
  const render = () =>
    markup(<HtmlContent className="w-full">{body}</HtmlContent>);
  cookie = undefined;
  const visible = await render();
  expect(visible).toContain("pictures.test/photo.jpg");
  for (const mode of ["postImages", "all"]) {
    cookie = mode;
    const hidden = await render();
    noArtwork(hidden);
    expect(hidden).toContain('href="/destination"');
    expect(hidden).toContain("Before");
    expect(rootClasses(hidden)).toEqual(rootClasses(visible));
  }
});

test("backend HTML drops its pictures when post images are blocked and gains nothing", async () => {
  const body =
    '<h2>Using the site</h2><p>Before <a href="/destination">a link</a> after.</p><p><img src="https://pictures.test/photo.jpg" alt="x"></p>' +
    '<p style="background:url(https://pictures.test/back.png)">styled</p><ul><li>item</li></ul>';
  const render = () =>
    markup(<HtmlContent className="mt-6">{body}</HtmlContent>);
  cookie = undefined;
  const visible = await render();
  expect(visible).toContain("pictures.test/photo.jpg");
  expect(visible).toContain("pictures.test/back.png");
  expect(visible).toContain(body);
  expect(visible).not.toMatch(/<script|<style|<link|on\w+=/i);
  for (const mode of ["postImages", "all"]) {
    cookie = mode;
    const hidden = await render();
    noArtwork(hidden);
    expect(hidden).not.toContain("pictures.test");
    expect(hidden).toContain("DATA SAVER");
    expect(hidden).toContain('<a href="/destination">a link</a>');
    expect(hidden).toContain("<h2>Using the site</h2>");
    expect(hidden).not.toMatch(/<script|<style|<link|on\w+=/i);
    expect(rootClasses(hidden)).toEqual(rootClasses(visible));
  }
  // Other categories leave a remote picture alone.
  cookie = "avatars";
  expect(await render()).toContain("pictures.test/photo.jpg");
});

test("a blocked category empties local pictures in stored HTML and editor props", async () => {
  const html =
    '<p>Before <img src="/pictures/ring.png"> and <img src="https://pictures.test/y.jpg"> <a href="https://example.test/guide">docs</a></p>';
  const source =
    "Before [IMG]https://pictures.test/y.jpg[/IMG] [URL=https://example.test/guide]docs[/URL]\n";
  cookie = "frames";
  const drawn = await markup(<HtmlContent>{html}</HtmlContent>);
  expect(drawn).not.toContain("/pictures/ring.png");
  expect(drawn).toContain("pictures.test/y.jpg");
  const { value } = await editorValue(source);
  expect(value).not.toContain("/pictures/ring.png");
  expect(value).toContain("pictures.test/y.jpg");
  expect(value).toContain("[URL=https://example.test/guide]docs[/URL]");
});

test("media HTML typed as text is text: the backend escapes it, and the editor gets it as typed", async () => {
  const source =
    'Hi <img src="https://pictures.test/x.png"> <svg><path d="M0 0h9"/></svg> end\n';
  const escaped =
    "<p>Hi &lt;img src=&quot;x.png&quot;&gt; &lt;svg&gt;&lt;path/&gt;&lt;/svg&gt; end</p>";
  cookie = "postImages";
  const html = await markup(<HtmlContent>{escaped}</HtmlContent>);
  expect(html).not.toMatch(/<img|<svg|<path/);
  expect(html).toContain("Hi");
  expect(html).toContain("end");
  // Typed HTML is no picture, so nothing in the source is filtered.
  const { value } = await editorValue(source);
  expect(value).toBe(source);
});

test("the server filters BB code before passing editor props to the client", async () => {
  const source =
    "Before [IMG]https://pictures.test/inline.jpg[/IMG] [URL=/destination][IMG]https://pictures.test/nested.png[/IMG][/URL] [CODE]\n[IMG]https://pictures.test/code.png[/IMG]\n[/CODE]\n";
  for (const mode of [undefined, "avatars", "postImages", "all"]) {
    cookie = mode;
    const element = await EditorDemo({ defaultValue: source });
    const value = element.props.defaultValue;
    if (mode === "postImages" || mode === "all") {
      expect(value).not.toContain("inline.jpg");
      expect(value).not.toContain("nested.png");
      expect(value).toContain("[URL=/destination]DATA SAVER[/URL]");
      // Code shows a tag as text and is a picture to nobody.
      expect(value).toContain("[IMG]https://pictures.test/code.png[/IMG]");
    } else expect(value).toBe(source);
  }
});

const tagLooking: [source: string, tail: string][] = [
  [
    "Use the <video> tag for clips.\n\nSecond paragraph stays?\n\n[LIST]\n[*]item\n[/LIST]",
    "[/LIST]",
  ],
  ["Array<object> and Map<string, embed> end", "end"],
  ["I export <svg> files from Figma.\n\nNext para", "Next para"],
];

test("tag-looking text never costs the reader the text after it", async () => {
  cookie = "postImages";
  for (const [source, tail] of tagLooking) {
    const { value } = await editorValue(source);
    expect(value.trimEnd().endsWith(tail), source).toBe(true);
    const escaped = source
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const html = await markup(<HtmlContent>{`<p>${escaped}</p>`}</HtmlContent>);
    expect(html, source).toContain(escaped);
  }
});

// The old statement (a signature never shows its pictures or the LITE label, whatever the visitor
// chose) held for the styleguide's Markdown signature, which dropped pictures for everyone. What
// members see is the backend's HTML, whose pictures the site's signature settings decide: those are
// drawn unless the visitor blocked them, and a blocked one is the LITE label, as in any text.
test("a signature kept as HTML follows LITE like any text, and keeps its words", async () => {
  const body =
    '<p>Hello <img src="https://pictures.test/b.png"> world</p><p>Use the &lt;video&gt; tag, Array&lt;object&gt; and &lt;svg&gt; files here</p>';
  for (const mode of [undefined, "avatars"]) {
    cookie = mode;
    expect(await markup(<SignatureHtml>{body}</SignatureHtml>)).toContain(
      "pictures.test/b.png",
    );
  }
  for (const mode of ["postImages", "all"]) {
    cookie = mode;
    const html = await markup(<SignatureHtml>{body}</SignatureHtml>);
    expect(html, mode).not.toMatch(/pictures\.test|<img/);
    expect(html, mode).toContain("DATA SAVER");
    for (const text of ["Hello", "world", "tag,", "files here"])
      expect(html, `${mode}: ${text}`).toContain(text);
  }
});

test("the signature field holds the stored source whatever LITE hides", async () => {
  const section = () => markup(<TitleSection />);
  const escaped = storedSignature.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  cookie = "postImages";
  const hidden = await section();
  // The field is the source the backend keeps, not filtered text: saving it back loses nothing.
  expect(hidden).toContain(escaped);
  // Blocked or not, the section draws no picture of its own.
  expect(hidden).not.toMatch(/<img|url\(/);
  cookie = undefined;
  expect(await section()).toContain(escaped);
});
