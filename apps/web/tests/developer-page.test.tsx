import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { DeveloperIntro } from "../src/app/[locale]/(developer)/developer/intro";
import {
  forBrowser,
  withJsonType,
} from "../src/app/[locale]/(developer)/developer/prepare-spec";
import {
  followSiteTheme,
  releaseSiteTheme,
} from "../src/app/[locale]/(developer)/developer/site-theme";
import type { Locale } from "../src/i18n/locales";
import { messagesFor } from "../src/i18n/messages";
import { LOCALE_DIRS } from "./locales";

const ROOT = join(import.meta.dir, "..");
const PAGE_DIR = join(ROOT, "src/app/[locale]/(developer)/developer");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}

test("the intro is written in every language, with the same facts", async () => {
  for (const dir of LOCALE_DIRS) {
    const locale = dir as Locale;
    const messages = await messagesFor(locale);
    const html = renderToStaticMarkup(
      <IntlProvider locale={locale} messages={messages} timeZone="UTC">
        <DeveloperIntro />
      </IntlProvider>,
    );
    const intro = messages.developer.intro;
    for (const key of [
      "lead",
      "authHeading",
      "realRequests",
      "keysHeading",
      "limitsHeading",
    ] as const) {
      expect(html, `${locale} ${key}`).toContain(intro[key]);
    }
    // The commands are drawn as code, and the specification is a link to the public document.
    expect(html, locale).toContain("<code");
    expect(html, locale).toContain("POST /api/auth/api-key/create");
    expect(html, locale).toContain("Authorization: Bearer");
    expect(html, locale).toContain('href="/api/v1/openapi.json"');
    // What a key may not do, and how the API refuses.
    for (const status of ["401", "403", "404", "429"]) {
      expect(html, `${locale} ${status}`).toContain(status);
    }
  }
});

test("the two languages do not share the intro's words", async () => {
  const en = (await messagesFor("en")).developer.intro;
  const es = (await messagesFor("es")).developer.intro;
  expect(es.lead).not.toBe(en.lead);
  expect(es.authHeading).not.toBe(en.authHeading);
});

test("the page is public and open to search engines, with its own title and description", () => {
  const page = read("src/app/[locale]/(developer)/developer/page.tsx");
  expect(page).not.toContain("NOINDEX");
  expect(page).not.toContain("robots");
  expect(page).toContain("metaTitle");
  expect(page).toContain("metaDescription");
  // No member gate: the page reads no viewer.
  expect(page).not.toContain("getViewer");
  expect(page).not.toContain("getMember");
});

test("the reference library is asked for with a dynamic import and nowhere else", () => {
  const holders: string[] = [];
  for (const file of files(join(ROOT, "src"))) {
    if (!/\.tsx?$/.test(file) || /\.(test\.tsx?|d\.ts)$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    if (!source.includes("swagger-ui-dist")) continue;
    holders.push(relative(ROOT, file).replaceAll("\\", "/"));
    // A static import of the script, in any form (named, default, side-effect, require), would put
    // it in the first load of the page. Once the one dynamic import and the stylesheet's
    // side-effect import are taken out, the library is not named at all.
    const dynamic =
      /import\(\s*["']swagger-ui-dist\/swagger-ui-es-bundle\.js["']\s*\)/g;
    expect(source, file).toMatch(dynamic);
    const rest = source
      .replace(dynamic, "")
      .replace(/^import\s+["']swagger-ui-dist\/swagger-ui\.css["'];?$/m, "");
    expect(rest, file).not.toContain("swagger-ui-dist");
  }
  expect(holders).toEqual([
    "src/app/[locale]/(developer)/developer/api-reference.tsx",
  ]);
  // Its stylesheet is a side-effect import of the same file, so it is the page's own.
  expect(
    read("src/app/[locale]/(developer)/developer/api-reference.tsx"),
  ).toContain('import "swagger-ui-dist/swagger-ui.css"');
});

test("the page names no other address in its scripts, styles or configuration", () => {
  for (const file of files(PAGE_DIR)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    const name = relative(ROOT, file).replaceAll("\\", "/");
    // Comments may name an address; code and styles may not.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code, name).not.toMatch(/https?:\/\//);
    expect(code, name).not.toMatch(/["'(]\/\/[a-z]/i);
    expect(code, name).not.toMatch(/@import\s+url\(/);
    expect(code, name).not.toMatch(/<(?:script|link)\b/);
  }
  const reference = read(
    "src/app/[locale]/(developer)/developer/api-reference.tsx",
  );
  // The library's own default asks swagger.io to validate the document.
  expect(reference).toContain("validatorUrl: null");
  // The specification is the site's own, and nothing is kept by the page.
  expect(reference).toContain(
    'fetch(SPEC_PATH, { signal, credentials: "omit" })',
  );
  // The address stays the page's own, and the library reads no configuration from it.
  expect(reference).toContain("deepLinking: false");
  expect(reference).toContain("withCredentials: false");
  expect(reference).toContain("queryConfigEnabled: false");
  expect(reference).not.toMatch(/\b(?:configUrl|urls|url)\s*:/);
  expect(reference).not.toMatch(
    /localStorage|sessionStorage|persistAuthorization: true/,
  );
});

test("the page has a budget group of its own, ahead of the general one", () => {
  const { budgets } = JSON.parse(read("js-budgets.json")) as {
    budgets: { name: string; match: string }[];
  };
  const route = "/[locale]/(developer)/developer";
  const first = budgets.find((budget) => new RegExp(budget.match).test(route));
  expect(first?.name).toBe("developer");
  // The group does not catch anything else.
  for (const other of [
    "/[locale]/(developer)/developers",
    "/[locale]/(developer)/developer/x",
    "/[locale]/(main)/search",
  ]) {
    expect(new RegExp(first?.match ?? "").test(other), other).toBe(false);
  }
});

const SPEC = {
  openapi: "3.1.0",
  servers: [{ url: "/" }],
  paths: {
    "/api/v1/nodes": {
      get: {
        security: [
          { sessionCookie: [] },
          { secureSessionCookie: [] },
          { bearerApiKey: [] },
          {},
        ],
      },
    },
    "/api/v1/me": {
      get: {
        security: [
          { sessionCookie: [] },
          { secureSessionCookie: [] },
          { bearerApiKey: [] },
        ],
      },
      parameters: [{ name: "x", in: "query" }],
    },
    "/api/auth/api-key/create": {
      post: { security: [{ bearerAuth: [] }] },
    },
    "/health": { get: { security: [] } },
    "/robots.txt": { get: {} },
  },
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "sermo.session" },
      secureSessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "__Secure-sermo.session",
      },
      bearerApiKey: { type: "http", scheme: "bearer" },
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: { Error: { type: "object" } },
  },
};

type Spec = typeof SPEC;

test("the reference points at the site itself and offers no cookie to paste", () => {
  const before = JSON.stringify(SPEC);
  const shown = forBrowser(SPEC, "https://forum.example") as Spec;
  expect(shown.servers).toEqual([{ url: "https://forum.example" }]);
  expect(Object.keys(shown.components.securitySchemes)).toEqual([
    "bearerApiKey",
    "bearerAuth",
  ]);
  // Anonymous access stays an alternative, and the key is the one credential left.
  expect(shown.paths["/api/v1/nodes"].get.security).toEqual([
    { bearerApiKey: [] },
    {},
  ]);
  expect(shown.paths["/api/v1/me"].get.security).toEqual([
    { bearerApiKey: [] },
  ]);
  // Everything else is as it was: other schemes, an operation with none, path-level fields,
  // schemas, and the operations themselves (the whole specification is shown).
  expect(shown.paths["/api/auth/api-key/create"].post.security).toEqual([
    { bearerAuth: [] },
  ]);
  expect(shown.paths["/health"].get.security).toEqual([]);
  expect(shown.paths["/robots.txt"].get).toEqual({});
  expect(shown.paths["/api/v1/me"].parameters).toEqual([
    { name: "x", in: "query" },
  ]);
  expect(shown.components.schemas).toEqual(SPEC.components.schemas);
  expect(Object.keys(shown.paths)).toEqual(Object.keys(SPEC.paths));
  // The document that was read is not changed.
  expect(JSON.stringify(SPEC)).toBe(before);
});

test("a document without components or paths still gets the site as its server", () => {
  expect(forBrowser({ openapi: "3.1.0" }, "https://forum.example")).toEqual({
    openapi: "3.1.0",
    servers: [{ url: "https://forum.example" }],
    paths: {},
    components: { securitySchemes: {} },
  });
});

test("the real shape of the specification: the session cookies go, the key and the sign-in service stay", () => {
  const real = {
    paths: {
      "/api/v1/threads": {
        post: {
          security: [
            { sessionCookie: [] },
            { secureSessionCookie: [] },
            { bearerApiKey: [] },
          ],
        },
      },
      "/api/auth/sign-in/email": { post: { security: [{ bearerAuth: [] }] } },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "sermo.session_token",
        },
        secureSessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "__Secure-sermo.session_token",
        },
        bearerApiKey: { type: "http", scheme: "bearer" },
      },
    },
  };
  const shown = forBrowser(real, "http://localhost:3000") as typeof real;
  expect(Object.keys(shown.components.securitySchemes)).toEqual([
    "bearerAuth",
    "bearerApiKey",
  ]);
  expect(shown.paths["/api/v1/threads"].post.security).toEqual([
    { bearerApiKey: [] },
  ]);
  expect(shown.paths["/api/auth/sign-in/email"].post.security).toEqual([
    { bearerAuth: [] },
  ]);
});

test("a write without a body says it is JSON, and nothing else is changed", () => {
  // A DELETE with only a path parameter: the API answers 415 to a cookie request without it.
  expect(
    withJsonType({
      url: "/api/v1/threads/4",
      method: "DELETE",
      headers: { Accept: "*/*" },
    }),
  ).toEqual({
    url: "/api/v1/threads/4",
    method: "DELETE",
    headers: { Accept: "*/*", "Content-Type": "application/json" },
  });
  const post: Parameters<typeof withJsonType>[0] = {
    url: "/api/v1/threads",
    method: "POST",
  };
  expect(withJsonType(post).headers).toEqual({
    "Content-Type": "application/json",
  });
  // A body (JSON, or an upload whose boundary the browser sets), a type already named, and
  // reads are left alone.
  const untouched: Parameters<typeof withJsonType>[0][] = [
    { url: "/api/v1/x", method: "POST", body: "{}", headers: {} },
    { url: "/api/v1/x", method: "POST", body: new FormData(), headers: {} },
    {
      url: "/api/v1/x",
      method: "PUT",
      headers: { "content-type": "text/plain" },
    },
    { url: "/api/v1/x", method: "GET", headers: {} },
    { url: "/api/v1/x", method: "head" },
    {},
  ];
  for (const request of untouched) {
    const before = JSON.stringify(request.headers ?? null);
    expect(JSON.stringify(withJsonType(request).headers ?? null)).toBe(before);
  }
});

test("the Authorize dialog says which scheme takes the key", () => {
  const spec = {
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
        sessionCookie: { type: "apiKey", in: "cookie", name: "sermo.session" },
        bearerApiKey: { type: "http", scheme: "bearer" },
        other: { type: "http", scheme: "basic" },
      },
    },
  };
  const { securitySchemes } = (
    forBrowser(spec, "https://forum.example") as {
      components: { securitySchemes: Record<string, Record<string, string>> };
    }
  ).components;
  expect(securitySchemes.bearerApiKey.description).toContain("API key");
  expect(securitySchemes.bearerApiKey.description).toContain("session");
  expect(securitySchemes.bearerAuth.description).toContain("Not for API keys");
  // A scheme the page does not know keeps what the document says, and the scheme itself stays.
  expect(securitySchemes.other).toEqual({ type: "http", scheme: "basic" });
  expect(securitySchemes.bearerApiKey.scheme).toBe("bearer");
  // The input is not changed.
  expect(
    (spec.components.securitySchemes.bearerApiKey as Record<string, string>)
      .description,
  ).toBeUndefined();
});

test("a bodyless write gets the JSON type only on the REST API", () => {
  const write = (url: string) =>
    withJsonType({
      url,
      method: "DELETE",
      headers: {} as Record<string, string>,
    }).headers;
  expect(write("http://localhost:3000/api/v1/threads/4")).toEqual({
    "Content-Type": "application/json",
  });
  // The sign-in service, the SEO documents and anything else have no such rule.
  for (const url of [
    "http://localhost:3000/api/auth/api-key/delete",
    "http://localhost:3000/health",
    "http://localhost:3000/api/v1",
    "not a url",
  ]) {
    expect(write(url), url).toEqual({});
  }
  expect(withJsonType({ method: "DELETE", headers: {} }).headers).toEqual({});
});

// A class list that can be looked at: the page's root element in a test.
function root(...names: string[]) {
  const set = new Set(names);
  let writes = 0;
  return {
    set,
    get writes() {
      return writes;
    },
    classList: {
      contains: (name: string) => set.has(name),
      toggle: (name: string, force: boolean) => {
        writes += 1;
        if (force) set.add(name);
        else set.delete(name);
      },
      remove: (name: string) => {
        writes += 1;
        set.delete(name);
      },
    },
  };
}

test("the library's dark look follows the site's theme and is gone when the page is left", () => {
  const html = root("dark", "h-full");
  followSiteTheme(html);
  expect([...html.set].sort()).toEqual(["dark", "dark-mode", "h-full"]);
  // Following again changes nothing, so an observer of the class list is not called again.
  const written = html.writes;
  followSiteTheme(html);
  expect(html.writes).toBe(written);
  // The site turns light: the library's class goes with it.
  html.set.delete("dark");
  followSiteTheme(html);
  expect([...html.set]).toEqual(["h-full"]);
  followSiteTheme(html);
  expect(html.writes).toBe(written + 1);
  // Leaving the page removes the class whatever the theme, and the site's own classes stay.
  html.set.add("dark");
  followSiteTheme(html);
  releaseSiteTheme(html);
  expect([...html.set].sort()).toEqual(["dark", "h-full"]);
  // A light site never gets the class.
  const light = root("h-full");
  followSiteTheme(light);
  expect([...light.set]).toEqual(["h-full"]);
  expect(light.writes).toBe(0);
});

test("the component follows the theme through the pure helpers", () => {
  const reference = read(
    "src/app/[locale]/(developer)/developer/api-reference.tsx",
  );
  expect(reference).toContain("followSiteTheme(root)");
  expect(reference).toContain("releaseSiteTheme(root)");
});
