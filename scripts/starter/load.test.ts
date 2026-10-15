import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contracts, createStorage, execute, getOperation, localDriver, schema } from "@sermo/core";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import {
  frameGeometry,
  measureFrameOpening,
} from "../../packages/core/src/modules/images/frame-geometry";
import awards from "./data/awards.json";
import covers from "./data/covers.json";
import forums from "./data/forums.json";
import frames from "./data/frames.json";
import palettes from "./data/palettes.json";
import settings from "./data/settings.json";
import shop from "./data/shop.json";
import { loadStarter, StarterAbort, type StarterLine } from "./loader";

const root = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(resolve(root, "../../packages/core/package.json"))("sharp");
const scratch = mkdtempSync(join(tmpdir(), "sermo-starter-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function boot() {
  const ctx = createTestContext();
  const admin = insertUser(ctx, { username: "nova", groupId: schema.GROUP_IDS.admin });
  const actor = userActor(admin);
  const dir = join(scratch, `site-${++counter}`);
  const storage = createStorage(ctx, {
    driver: localDriver(join(dir, "files")),
    tempDir: join(dir, "tmp"),
  });
  return { ctx, actor, storage };
}
type Site = ReturnType<typeof boot>;

const run = <T>(site: Site, name: string, input: unknown = {}) =>
  execute(site.ctx, getOperation(name), site.actor, input) as Promise<T>;

function load(site: Site, extra: Partial<Parameters<typeof loadStarter>[0]> = {}) {
  const read: string[] = [];
  const lines = loadStarter({
    ...site,
    root,
    readFile: async (path) => {
      read.push(path);
      return new Uint8Array(await Bun.file(path).arrayBuffer());
    },
    ...extra,
  });
  return { lines, read };
}

const count = (lines: StarterLine[], outcome: StarterLine["outcome"]) =>
  lines.filter((line) => line.outcome === outcome).length;

type Item = { id: number; name: string; effect: { type: string } & Record<string, number> };
async function snapshot(site: Site) {
  const items = async (kind: string) =>
    (
      await run<{ items: { id: number; name: string; placement: unknown }[] }>(
        site,
        "catalogImages.list",
        { kind },
      )
    ).items;
  const shopItems: Item[] = [];
  const categories = (
    await run<{ items: { id: number; name: string }[] }>(site, "shopCategories.list")
  ).items;
  for (const category of categories) {
    let cursor: string | undefined;
    do {
      const page = await run<{ items: Item[]; nextCursor: string | null }>(site, "shopItems.list", {
        categoryId: category.id,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      shopItems.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  return {
    frames: await items("frame"),
    profileCovers: await items("profile_cover"),
    threadCovers: await items("thread_cover"),
    colors: {
      accent: (
        await run<{ items: { id: number }[] }>(site, "paletteColors.list", { kind: "accent" })
      ).items,
      name: (await run<{ items: { id: number }[] }>(site, "paletteColors.list", { kind: "name" }))
        .items,
      prefix: (
        await run<{ items: { id: number }[] }>(site, "paletteColors.list", { kind: "prefix" })
      ).items,
    },
    nodes: (
      await run<{ items: { type: string; icon: unknown; cover: unknown; tabId: number | null }[] }>(
        site,
        "nodes.list",
      )
    ).items,
    tabs: (await run<{ items: unknown[] }>(site, "forumTabs.list")).items,
    prefixes: (await run<{ items: unknown[] }>(site, "threadPrefixes.list")).items,
    groups: (await run<{ items: { id: number; title: string }[] }>(site, "groups.list")).items,
    categories,
    shopItems,
    awards: (
      await run<{
        items: { name: string; image: unknown; rule: { conditions: { criterion: string }[] } }[];
      }>(site, "awards.list")
    ).items,
    rules: (await run<{ items: unknown[] }>(site, "creditRules.list")).items,
    pages: (await run<{ items: { slug: string }[] }>(site, "pages.list")).items,
    settings: await run<Record<string, unknown>>(site, "settings.get"),
  };
}

const forumCount = forums.categories.reduce(
  (total, category) =>
    total + category.forums.reduce((sum, forum) => sum + 1 + forum.subforums.length, 0),
  0,
);
const pageFiles = readdirSync(join(root, "pages")).filter((name) => name.endsWith(".md"));
const TIMEOUT = 240_000;

const first = boot();

describe("starter content", () => {
  let lines: StarterLine[];
  let read: string[];

  test(
    "a first load creates every kind from the source data",
    async () => {
      const started = load(first);
      lines = await started.lines;
      read = started.read;
      expect(lines.filter((line) => line.outcome === "failed")).toEqual([]);

      const state = await snapshot(first);
      expect(state.frames).toHaveLength(frames.length);
      expect(state.profileCovers).toHaveLength(covers.profile.length);
      expect(state.threadCovers).toHaveLength(covers.thread.length);
      // The migrations already seed the colours; matching by value keeps them single.
      expect(state.colors.accent).toHaveLength(palettes.accent.length);
      expect(state.colors.name).toHaveLength(palettes.name.length);
      expect(state.colors.prefix).toHaveLength(palettes.prefix.length);
      // The fixture's own nodes are none: a bare database holds just the starter forums.
      expect(state.nodes.filter((node) => node.type === "category")).toHaveLength(
        forums.categories.length,
      );
      expect(state.nodes.filter((node) => node.type === "forum")).toHaveLength(forumCount);
      const pictured = state.nodes.filter((node) => node.icon && node.cover);
      expect(pictured).toHaveLength(forums.categories.reduce((n, c) => n + c.forums.length, 0));
      expect(state.tabs).toHaveLength(forums.tabs.length);
      expect(state.prefixes).toHaveLength(forums.prefixes.length);
      for (const rank of shop.rankGroups)
        expect(state.groups.some((group) => group.title === rank.title)).toBe(true);
      expect(state.categories).toHaveLength(shop.categories.length);
      expect(state.shopItems).toHaveLength(shop.items.length);
      expect(state.awards).toHaveLength(awards.length);
      expect(state.awards.every((award) => award.image)).toBe(true);
      expect(state.rules).toHaveLength(settings.creditRules.length);
      expect(state.pages.map((page) => page.slug).sort()).toEqual(
        pageFiles.map((name) => name.replace(/\.md$/, "")).sort(),
      );
      expect(state.settings.logoFileId).not.toBeNull();
      expect(state.settings.iconFileId).not.toBeNull();
      expect(state.settings.levelTitles).toEqual(settings.levelTitles);
    },
    TIMEOUT,
  );

  test("award criteria that use a rank name the rank's shop item", async () => {
    const state = await snapshot(first);
    const ranks = state.shopItems
      .filter((item) => item.effect.type === "group")
      .map((item) => item.id);
    const bought = state.awards
      .flatMap((award) => award.rule.conditions)
      .filter((criterion) => criterion.criterion === "purchased_item");
    expect(bought).toHaveLength(ranks.length);
  });

  test("every frame entry keeps the placement of the data file", async () => {
    const { frames: entries } = await snapshot(first);
    for (const frame of frames) {
      contracts.FramePlacement.parse(frame.placement);
      expect(entries.find((entry) => entry.name === frame.name)?.placement).toEqual(
        frame.placement,
      );
    }
  });

  test("the converted placement agrees with the opening the backend measures", async () => {
    for (const name of ["569.png", "619.png"]) {
      const { data, info } = await sharp(join(root, "assets", "frames", name))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const opening = measureFrameOpening(data, info.width, info.height)!;
      const measured = frameGeometry(opening, info.width, info.height);
      const old = frames.find((frame) => frame.file === name)!.placement;
      expect(Math.abs(old.width - measured.width)).toBeLessThan(2);
      expect(Math.abs(old.left - measured.left)).toBeLessThan(1.5);
      expect(Math.abs(old.top - measured.top)).toBeLessThan(1.5);
      expect(Math.abs(old.scale - measured.scale)).toBeLessThan(3);
    }
  });

  test("every shop item's effect names an existing entry", async () => {
    const state = await snapshot(first);
    const ids = {
      frame: new Set(state.frames.map((entry) => entry.id)),
      nameColor: new Set(state.colors.name.map((entry) => entry.id)),
      threadCover: new Set(state.threadCovers.map((entry) => entry.id)),
      group: new Set(state.groups.map((group) => group.id)),
    };
    const refs = {
      frame: "frameId",
      nameColor: "colorId",
      threadCover: "coverId",
      group: "groupId",
    } as const;
    let checked = 0;
    for (const item of state.shopItems) {
      const type = item.effect.type as keyof typeof refs;
      if (!(type in refs)) continue;
      expect(ids[type].has(item.effect[refs[type]]!)).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(
      (shop.items as { effect: { type: string } }[]).filter((item) =>
        ["frame", "nameColor", "threadCover", "group"].includes(item.effect.type),
      ).length,
    );
  });

  test("the name icon items load with their icon and side", async () => {
    const state = await snapshot(first);
    const icons = state.shopItems.filter((item) => item.effect.type === "nameIcon");
    const wanted = shop.items.filter((item) => item.effect.type === "nameIcon");
    expect(wanted.length).toBeGreaterThan(0);
    expect(icons.map((item) => item.effect as object)).toEqual(
      wanted.map((item) => item.effect as object),
    );
  });

  test("no file under apps/web is read", () => {
    expect(read.length).toBeGreaterThan(150);
    for (const path of read) {
      const normal = resolve(path).replaceAll("\\", "/");
      expect(normal.startsWith(`${root.replaceAll("\\", "/")}/`)).toBe(true);
      expect(normal).not.toContain("apps/web");
    }
  });

  test(
    "a second load creates nothing",
    async () => {
      const before = await snapshot(first);
      const second = await load(first).lines;
      expect(count(second, "created")).toBe(0);
      expect(count(second, "failed")).toBe(0);
      expect(count(second, "skipped")).toBe(0);
      expect(second.length).toBeGreaterThan(300);
      const after = await snapshot(first);
      expect(after).toEqual(before);
    },
    TIMEOUT,
  );
});

describe("an interrupted load", () => {
  test(
    "completes when run again",
    async () => {
      const reference = await snapshot(first);

      const site = boot();
      for (const limit of [40, 180]) {
        let thrown: unknown;
        try {
          await load(site, {
            beforeOperation: (n) => {
              if (n === limit) throw new StarterAbort("interrupted");
            },
          }).lines;
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(StarterAbort);
      }
      const finished = await load(site).lines;
      expect(count(finished, "failed")).toBe(0);
      expect(count(finished, "created")).toBeGreaterThan(0);

      const again = await load(site).lines;
      expect(count(again, "created")).toBe(0);
      const after = await snapshot(site);
      expect(after.frames).toHaveLength(reference.frames.length);
      expect(after.shopItems).toHaveLength(reference.shopItems.length);
      expect(after.awards).toHaveLength(reference.awards.length);
      expect(after.nodes).toHaveLength(reference.nodes.length);
      expect(after.pages).toHaveLength(reference.pages.length);
      expect(after.rules).toHaveLength(reference.rules.length);
      expect(after.awards.every((award) => award.image)).toBe(true);
    },
    TIMEOUT * 2,
  );
});

describe("failures", () => {
  test(
    "a failing step is reported and the rest still loads",
    async () => {
      const site = boot();
      // Without its categories the shop items fail one by one; everything else still loads.
      const failing = await load(site, {
        beforeOperation: (_n, name) => {
          if (name === "shopCategories.create") throw new Error("injected");
        },
      }).lines;
      expect(count(failing, "failed")).toBeGreaterThan(0);
      expect(failing.some((line) => line.kind === "page" && line.outcome === "created")).toBe(true);
      const repaired = await load(site).lines;
      expect(count(repaired, "failed")).toBe(0);
    },
    TIMEOUT,
  );
});
