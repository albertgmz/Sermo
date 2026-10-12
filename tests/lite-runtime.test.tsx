import { afterEach, expect, mock, test } from "bun:test";
import { NextRequest, type NextResponse } from "next/server";
import { createElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { messages } from "../src/i18n/messages";
import { LITE_CATEGORIES, LITE_COOKIE } from "../src/lib/lite-preferences";
import { IMAGE_EXTENSIONS, owners, publicImages, read } from "./lite-scan";

// Mock only the missing server environment and data boundary. The real cookie
// parser, server LITE helpers, proxy, gates and React renderer run unchanged.
let cookie: string | undefined;
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
const find = async (id: number) => (id === 101 ? { id } : null);
function noDatabaseWrites(): never {
  throw new Error("LITE tests must not write the demo database");
}
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
mock.module("@/lib/db", () => ({
  getUserById: async (id: number) =>
    id === 101
      ? { id, role: "member" }
      : id === 102
        ? { id, role: "admin" }
        : null,
  getAward: find,
  getConversation: find,
  getForum: find,
  getThread: find,
  endSession: noDatabaseWrites,
  recordSignIn: noDatabaseWrites,
}));

// Dynamic imports ensure mocks are installed before the server modules load.
const { proxy, config } = await import("../src/proxy");
const { COOKIE } = await import("../src/lib/session");
const { Art } = await import("../src/components/forum/art");
const { UserAvatar } = await import("../src/components/forum/user-avatar");
const { AwardIcon } = await import("../src/components/forum/award-icon");
const { ShopIcon } = await import("../src/components/forum/shop-icon");
const { Markdown } = await import("../src/components/forum/markdown");
const { SiteIcon } = await import("../src/components/layout/site-icon");
const { LogoMark } = await import("../src/components/layout/logo");
const { PageBackdrop } = await import("../src/components/layout/page-backdrop");
const { EditorDemo } = await import("../src/app/(main)/ui/editor-demo");
const { FRAMES } = await import("../src/lib/frames");

afterEach(() => {
  cookie = undefined;
});

function request(path: string, lite?: string, viewer?: string, method = "GET") {
  const value = new NextRequest(`https://forum.test${path}`, { method });
  if (lite !== undefined) value.cookies.set(LITE_COOKIE, lite);
  if (viewer !== undefined) value.cookies.set(COOKIE, viewer);
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

const pictures = publicImages();

test("proxy replaces every public image for master/legacy cookies and passes every image without a cookie", async () => {
  expect(pictures.length).toBeGreaterThan(0);
  for (const picture of pictures) {
    const path = picture.slice("public".length);
    for (const master of ["all", "1"])
      await placeholder(
        await proxy(request(path, master)),
        `${path} (${master})`,
      );
    passThrough(await proxy(request(path)), path);
  }
});

for (const { key } of LITE_CATEGORIES) {
  test(`proxy blocks only ${key} when that category alone is selected`, async () => {
    for (const picture of pictures) {
      const path = picture.slice("public".length);
      const response = await proxy(request(path, key));
      if (owners(picture).some((category) => category.key === key))
        await placeholder(response, `${key}: ${path}`);
      else passThrough(response, `${key}: ${path}`);
    }
  });
}

test("proxy blocks encoded, Windows, case, slash and dot aliases of every public picture", async () => {
  for (const picture of pictures) {
    const path = picture.slice("public".length);
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
  expect(config.matcher).toEqual(["/:path*"]);
  for (const path of [
    "/_next/image?url=%2Favatars%2Ftest.jpg&w=640&q=75",
    "/_next/image?url=https%3A%2F%2Fpictures.test%2Fx.png&w=640&q=75",
  ])
    for (const mode of ["all", ...LITE_CATEGORIES.map(({ key }) => key)])
      await placeholder(await proxy(request(path, mode)), `${mode}: ${path}`);
  passThrough(
    await proxy(request("/_next/image?url=%2Favatars%2Fx.jpg")),
    "optimizer without cookie",
  );
  for (const path of ["/_next/static/app.js", "/styles.css", "/robots.txt"])
    passThrough(await proxy(request(path, "all")), path);
});

test("LITE retains guest redirects, admin protection and unknown-id 404s", async () => {
  for (const mode of [undefined, "all", "avatars"]) {
    const guest = await proxy(request("/account", mode));
    expect(guest?.status).toBe(307);
    expect(guest?.headers.get("location")).toBe("https://forum.test/login");
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
  for (const path of ["/", "/account", "/avatars/test.jpg"]) {
    const response = await proxy(request(path, "1"));
    expect(response?.cookies.get(LITE_COOKIE)?.value).toBe("all");
    const header = response?.headers.get("set-cookie") ?? "";
    expect(header).not.toContain("HttpOnly");
    expect(header).toContain("Path=/");
    expect(header).toContain("SameSite=lax");
  }
  const post = await proxy(
    request("/avatars/test.jpg", "1", undefined, "POST"),
  );
  expect(post?.headers.get("set-cookie")).toBe(null);
  await placeholder(post, "legacy POST image");
});

async function markup(node: ReactNode) {
  // Wait for all Suspense boundaries; renderToStaticMarkup alone hides async
  // children behind fallbacks and would give a false positive for blocked art.
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

function noArtwork(html: string) {
  expect(html).not.toMatch(
    /pictures\.test|\/avatars\/|\/frames\/|\/icon\.svg|<img\b|<image\b|<path\b|\sd=|url\(|data:image/,
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
  const frame = Object.keys(FRAMES)[0];
  const user = {
    username: "Example",
    avatar: "https://pictures.test/avatar.jpg",
    appearance: { frame },
  };
  for (const size of ["xs", "sm", "md", "lg", "xl", "2xl"] as const) {
    cookie = undefined;
    const visible = renderToStaticMarkup(
      await UserAvatar({ user, size, link: false }),
    );
    expect(visible).toContain(user.avatar);
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
  expect(frameOnly).not.toContain(user.avatar);
  expect(frameOnly).toContain(`/frames/${frame}.png`);
  cookie = "frames";
  const avatarOnly = renderToStaticMarkup(
    await UserAvatar({ user, link: false }),
  );
  expect(avatarOnly).toContain(user.avatar);
  expect(avatarOnly).not.toContain("/frames/");
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
      draw: async () =>
        await ShopIcon({ category: "frame", className: "size-12" }),
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
    else expect(html).toContain("/icon.svg");
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
