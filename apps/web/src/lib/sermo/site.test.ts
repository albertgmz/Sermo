import { afterEach, mock, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { siteBody } from "@/lib/test-bodies";
import layout from "../../../messages/en/layout.json";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
// Bun applies module mocks to the whole run, so these match the ones in the LITE runtime test.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) =>
    (layout.site as Record<string, string>)[key],
}));

const { getSite, siteDescription } = await import("./site");

const noSocialLinks = { discord: null, telegram: null, x: null };
const socialLinks = { ...noSocialLinks, discord: "https://discord.gg/example" };

test("the site is read without the visitor and keeps only its identity", async () => {
  const seen: Headers[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push(new Headers(init.headers));
    return Response.json(
      siteBody({ logo: { fileId: 3, url: "/api/v1/files/3" }, socialLinks }),
    );
  }) as unknown as typeof fetch;
  const site = await getSite();
  assert.deepEqual(site, {
    name: "Garden Club",
    description: "",
    logo: { fileId: 3, url: "/api/v1/files/3" },
    icon: null,
    backdrop: null,
    socialLinks,
    maxUploadBytes: siteBody().maxUploadBytes,
    forumStatsEnabled: false,
    accents: [],
  });
  assert.equal(seen[0].get("cookie"), null);
  assert.equal(seen[0].get("x-forwarded-for"), null);
});

test("the palette's accents are kept in display order with their colours", async () => {
  const accent = (id: number, color: string, foreground: string | null) => ({
    id,
    kind: "accent",
    name: `Accent ${id}`,
    color,
    foreground,
    position: id,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  globalThis.fetch = (async () =>
    Response.json(
      siteBody({
        palette: {
          accents: [
            accent(4, "#0ea5e9", "#03131f"),
            accent(2, "#dc2626", null),
          ],
          nameColors: [],
          prefixColors: [],
        },
      }),
    )) as unknown as typeof fetch;
  assert.deepEqual((await getSite()).accents, [
    { id: 4, color: "#0ea5e9", foreground: "#03131f" },
    { id: 2, color: "#dc2626", foreground: null },
  ]);
});

test("the description is the site's own text, and empty when the answer does not carry one", () => {
  assert.equal(siteDescription({}), "");
  assert.equal(siteDescription({ description: "" }), "");
  assert.equal(
    siteDescription({ description: "  Tea and gardens. " }),
    "Tea and gardens.",
  );
  assert.equal(siteDescription({ description: null }), "");
  assert.equal(siteDescription({ description: 7 }), "");
});

test("the read is cached for a minute under the site tag", () => {
  const source = readFileSync(`${import.meta.dir}/site.ts`, "utf8");
  for (const part of [
    '"use cache"',
    "cacheLife({ stale: 60, revalidate: 60, expire: 3600 })",
    'cacheTag("site")',
  ])
    assert.ok(source.includes(part), part);
});

test("an unreachable backend gives the default name and is logged outside the build only", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const phase = process.env.NEXT_PHASE;
  try {
    process.env.NEXT_PHASE = "phase-production-server";
    const fresh = getSite;
    assert.deepEqual(await fresh(), {
      name: layout.site.defaultName,
      description: "",
      logo: null,
      icon: null,
      backdrop: null,
      socialLinks: noSocialLinks,
      maxUploadBytes: null,
      forumStatsEnabled: false,
      accents: [],
    });
    assert.equal(logged.mock.calls.length, 1);

    process.env.NEXT_PHASE = "phase-production-build";
    await fresh();
    assert.equal(logged.mock.calls.length, 1);
  } finally {
    if (phase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = phase;
    logged.mockRestore();
  }
});
