import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { DeveloperIntro } from "../src/app/[locale]/(main)/developer/intro";
import { forBrowser } from "../src/app/[locale]/(main)/developer/prepare-spec";
import type { Locale } from "../src/i18n/locales";
import { messagesFor } from "../src/i18n/messages";
import { LOCALE_DIRS } from "./locales";

const ROOT = join(import.meta.dir, "..");
const PAGE_DIR = join(ROOT, "src/app/[locale]/(main)/developer");
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
  const page = read("src/app/[locale]/(main)/developer/page.tsx");
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
    // A static import of the script would put it in the first load of the page.
    expect(source, file).not.toMatch(
      /import\s[^;]*from\s*["']swagger-ui-dist[^"']*\.js["']/,
    );
    expect(source, file).toMatch(
      /import\(\s*["']swagger-ui-dist\/swagger-ui-es-bundle\.js["']\s*\)/,
    );
  }
  expect(holders).toEqual([
    "src/app/[locale]/(main)/developer/api-reference.tsx",
  ]);
  // Its stylesheet is a side-effect import of the same file, so it is the page's own.
  expect(read("src/app/[locale]/(main)/developer/api-reference.tsx")).toContain(
    'import "swagger-ui-dist/swagger-ui.css"',
  );
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
  const reference = read("src/app/[locale]/(main)/developer/api-reference.tsx");
  // The library's own default asks swagger.io to validate the document.
  expect(reference).toContain("validatorUrl: null");
  // The specification is the site's own, and nothing is kept by the page.
  expect(reference).toContain("SPEC_PATH");
  expect(reference).not.toMatch(
    /localStorage|sessionStorage|persistAuthorization: true/,
  );
});

test("the page has a budget group of its own, ahead of the general one", () => {
  const { budgets } = JSON.parse(read("js-budgets.json")) as {
    budgets: { name: string; match: string }[];
  };
  const route = "/[locale]/(main)/developer";
  const first = budgets.find((budget) => new RegExp(budget.match).test(route));
  expect(first?.name).toBe("developer");
  // The group does not catch anything else.
  for (const other of [
    "/[locale]/(main)/developers",
    "/[locale]/(main)/developer/x",
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
