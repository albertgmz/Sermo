import { afterEach, expect, mock, test } from "bun:test";
import { NextRequest, type NextResponse } from "next/server";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { messages } from "../src/i18n/messages";
import { LITE_CATEGORIES, LITE_COOKIE } from "../src/lib/lite-preferences";
import { siteBody } from "../src/lib/test-bodies";
import { IMAGE_EXTENSIONS, read } from "./lite-scan";

// Mock only the missing server environment and data boundary. The real cookie
// parser, server LITE helpers, proxy, gates and React renderer run unchanged.
let cookie: string | undefined;
const storedSignature =
  "Shop: ![logo](https://pictures.test/l.png) <video> demo below\nline two";
mock.module("server-only", () => ({}));
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
mock.module("next-intl", () => ({ useTranslations: translator }));
mock.module("next-intl/server", () => ({
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
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
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
  return Response.json({
    ...site,
    ...siteBody(),
    ...site,
  });
}) as unknown as typeof fetch;
// The member as they edit their own profile.
mock.module("@/app/(main)/account/data", () => ({
  getSelf: async () => ({
    may: { setCustomTitle: false, setSignature: true },
    limits: {
      signatureMaxLength: 500,
      signatureMaxLines: 4,
      customTitleMaxLength: 40,
    },
    customTitle: null,
    signatureSource: storedSignature,
  }),
  getWorn: async () => ({}),
  getRenameUnits: async () => 0,
  shopHref: "/credits",
}));
// Dynamic imports ensure mocks are installed before the server modules load.
const { proxy, config } = await import("../src/proxy");
const { Art } = await import("../src/components/forum/art");
const { UserAvatar } = await import("../src/components/forum/user-avatar");
const { AwardIcon } = await import("../src/components/forum/award-icon");
const { ShopIcon } = await import("../src/components/forum/shop-icon");
const { Markdown } = await import("../src/components/forum/markdown");
const { HtmlContent } = await import("../src/components/forum/html-content");
const { SiteIcon } = await import("../src/components/layout/site-icon");
const { LogoMark } = await import("../src/components/layout/logo");
const { PageBackdrop } = await import("../src/components/layout/page-backdrop");
const { Signature } = await import("../src/components/forum/signature");
const { TitleSection } = await import(
  "../src/app/(main)/account/profile-forms"
);
const { EditorDemo } = await import("../src/app/(main)/ui/editor-demo");

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
    /^<svg\b[^>]*><text\b[^>]*>LITE MODE<\/text><\/svg>$/,
  );
  expect(body, context).not.toMatch(
    /<path\b|<image\b|\bhref=|data:image|url\(/,
  );
}

function passThrough(response: NextResponse | undefined, context: string) {
  if (!response) return;
  expect(response.headers.get("x-middleware-next"), context).toBe("1");
  expect(response.headers.get("location"), context).toBe(null);
  expect(response.headers.get("x-middleware-rewrite"), context).toBe(null);
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

test("proxy replaces every picture path for master/legacy cookies and passes every one without a cookie", async () => {
  for (const path of PICTURES) {
    for (const master of ["all", "1"])
      await placeholder(
        await proxy(request(path, master)),
        `${path} (${master})`,
      );
    passThrough(await proxy(request(path)), path);
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
    "https://forum.test/not-found",
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
  for (const path of ["/_next/static/app.js", "/styles.css", "/robots.txt"])
    passThrough(await proxy(request(path, "all")), path);
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
        "https://forum.test/not-found",
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
          "https://forum.test/not-found",
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
      expect(hidden).toContain("LITE MODE");
      for (const token of sizing.split(" ")) {
        expect(rootClasses(hidden)).toContain(token);
        expect(rootClasses(visible)).toContain(token);
      }
    }
    cookie = LITE_CATEGORIES.find(({ key: other }) => other !== key)?.key;
    expect(renderToStaticMarkup(await Art(props))).toContain(props.src);
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
  for (const size of ["xs", "sm", "md", "lg", "xl", "2xl"] as const) {
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
        element: createElement(LogoMark, { className: "size-12" }),
        url: "/api/v1/files/5",
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

test("Markdown rendering gates external images while preserving links and its root box", async () => {
  const source =
    "Before [![image](https://pictures.test/photo.jpg)](/destination) after.";
  const render = () => markup(<Markdown className="w-full">{source}</Markdown>);
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
    expect(hidden).toContain("LITE MODE");
    expect(hidden).toContain('<a href="/destination">a link</a>');
    expect(hidden).toContain("<h2>Using the site</h2>");
    expect(hidden).not.toMatch(/<script|<style|<link|on\w+=/i);
    expect(rootClasses(hidden)).toEqual(rootClasses(visible));
  }
  // Other categories leave a remote picture alone.
  cookie = "avatars";
  expect(await render()).toContain("pictures.test/photo.jpg");
});

test("a blocked category empties local pictures in Markdown and editor props", async () => {
  const source =
    "Before ![x](/pictures/ring.png) and ![y](https://pictures.test/y.jpg) [docs][d]\n\n[d]: https://example.test/guide\n";
  cookie = "frames";
  const html = await markup(<Markdown>{source}</Markdown>);
  expect(html).not.toContain("/pictures/ring.png");
  expect(html).toContain("pictures.test/y.jpg");
  const { value } = await editorValue(source);
  expect(value).not.toContain("/pictures/ring.png");
  expect(value).toContain("pictures.test/y.jpg");
  expect(value).toContain("[d]: https://example.test/guide");
});

test("media HTML typed as text never reaches the page or editor props", async () => {
  const source =
    'Hi <img src="https://pictures.test/x.png"> <svg><path d="M0 0h9"/></svg> end\n';
  cookie = "postImages";
  const html = await markup(<Markdown>{source}</Markdown>);
  expect(html).not.toMatch(/pictures\.test|M0 0h9/);
  expect(html).toContain("Hi");
  expect(html).toContain("end");
  const { value } = await editorValue(source);
  expect(value).not.toMatch(/pictures\.test|M0 0h9/);
  expect(value.startsWith("Hi ")).toBe(true);
  expect(value.endsWith(" end\n")).toBe(true);
});

test("the server filters Markdown before passing editor props to the client", async () => {
  const source =
    "Before ![inline](https://pictures.test/inline.jpg) [![nested][pic]](/destination) ![pic][] ![pic]\n\n[pic]: https://pictures.test/reference.jpg\n";
  for (const mode of [undefined, "avatars", "postImages", "all"]) {
    cookie = mode;
    const element = await EditorDemo({ defaultValue: source });
    const value = element.props.defaultValue;
    if (mode === "postImages" || mode === "all") {
      expect(value).not.toContain("pictures.test");
      expect(value).not.toContain("![");
      expect(value).toContain("[LITE MODE](/destination)");
    } else expect(value).toBe(source);
  }
});

const unclosed: [source: string, tail: string][] = [
  [
    "Use the <video> tag for clips.\n\nSecond paragraph stays?\n\n- item",
    "item",
  ],
  ["Array<object> and Map<string, embed> end", "end"],
  ["I export <svg> files from Figma.\n\nNext para", "Next para"],
];

test("tag-looking text never costs the reader the text after it", async () => {
  cookie = "postImages";
  for (const [source, tail] of unclosed) {
    const html = await markup(<Markdown>{source}</Markdown>);
    expect(html, source).toContain(tail);
    const { value } = await editorValue(source);
    expect(value.trimEnd().endsWith(tail), source).toBe(true);
  }
});

test("a signature never shows its pictures or the LITE label, whatever the visitor chose", async () => {
  const source = [
    "Hello ![banner](https://pictures.test/b.png) world",
    "![full][ref] after the reference",
    "Use the <video> tag, Array<object> and <svg> files here",
    "",
    "[ref]: /pictures/ring.png",
  ].join("\n");
  for (const mode of [undefined, "avatars", "postImages", "all"]) {
    cookie = mode;
    const html = await markup(<Signature>{source}</Signature>);
    expect(html, String(mode)).not.toMatch(
      /LITE MODE|pictures\.test|\/pictures\/|<img/,
    );
    for (const text of [
      "Hello",
      "world",
      "after the reference",
      "tag,",
      "files here",
    ])
      expect(html, `${mode}: ${text}`).toContain(text);
  }
});

test("the signature field holds the stored source whatever LITE hides", async () => {
  const section = () =>
    markup(<TitleSection searchParams={Promise.resolve({})} />);
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
