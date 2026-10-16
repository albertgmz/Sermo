import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeContext, createContext, execute, getOperation } from "@sermo/core";
import { PROFILES, SEED_PASSWORD, type SeedMeta, SIZES, scaleSizes, writeProfile } from "./seed";

const dir = mkdtempSync(join(tmpdir(), "sermo-seed-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the bench profile keeps the sizes the budgets are measured on", () => {
  expect(PROFILES.bench).toBe(SIZES);
  expect(scaleSizes(SIZES, 1)).toBe(SIZES);
  expect(SIZES).toEqual({
    nodes: 60,
    users: 10_000,
    threads: 50_000,
    posts: 1_000_000,
    profilePosts: 100_000,
    profilePostComments: 300_000,
    conversations: 20_000,
    conversationMessages: 400_000,
    reactions: {
      post: 1_400_000,
      profile_post: 250_000,
      profile_post_comment: 150_000,
      conversation_message: 200_000,
    },
    threadReads: 200_000,
    attachments: 300_000,
    reportGroups: 20_000,
    warnings: 10_000,
    moderatorLog: 200_000,
    lurkers: 50_000,
    groups: 40,
    groupCombinations: 3_000,
    promotions: 50,
    notifications: 2_000_000,
    threadWatches: 440_000,
    nodeWatches: 60_000,
    hotThreadWatchers: 20_000,
    hotNodeWatchers: 50_000,
    follows: 100_000,
    ignores: 50_000,
    creditRuleApplications: 400_000,
    awards: 60,
    memberAwards: 150_000,
    shopCategories: 6,
    shopItems: 90,
    shopPurchases: 80_000,
    shopGrantHolders: 1_000,
  });
});

test("the large profile grows content about tenfold and keeps the catalog", () => {
  const large = PROFILES.large;
  expect(large.users + large.lurkers).toBe(1_000_000);
  expect(large.posts).toBe(10 * SIZES.posts);
  expect(large.threads).toBe(10 * SIZES.threads);
  expect(large.groups).toBe(SIZES.groups);
  expect(large.shopItems).toBe(SIZES.shopItems);
  // Every visible thread earns a credit rule application, and the rest are replies.
  expect(large.creditRuleApplications).toBeGreaterThan(large.threads);
});

test("a scaled profile divides activity and keeps the catalog", () => {
  const tiny = scaleSizes(SIZES, 100);
  expect(tiny.posts).toBe(10_000);
  expect(tiny.users).toBe(100);
  expect(tiny.reactions.post).toBe(14_000);
  expect(tiny.awards).toBe(SIZES.awards);
});

test("a scaled profile is written to one complete file the backend opens", async () => {
  const out = join(dir, "forum", "sermo.db");
  const sizes = scaleSizes(SIZES, 100);
  await writeProfile("bench/100", sizes, out);
  // A second run replaces the first without leaving anything behind.
  const { meta } = await writeProfile("bench/100", sizes, out);

  const stored = JSON.parse(readFileSync(`${out}.json`, "utf8")) as SeedMeta & {
    profile: string;
    password: string;
  };
  expect(stored.adminId).toBe(1);
  expect(stored.moderatorIds).toEqual(meta.moderatorIds);
  expect(stored.memberIds.length).toBeGreaterThan(0);
  expect(stored.password).toBe(SEED_PASSWORD);
  expect(stored.sizes).toEqual(sizes);

  const ctx = createContext({ path: out });
  try {
    const count = (table: string) =>
      ctx.sqlite.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n;
    expect(ctx.sqlite.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(ctx.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(count("users")).toBe(sizes.users + sizes.lurkers);
    expect(count("posts")).toBe(sizes.posts);
    expect(count("search_fts")).toBe(sizes.posts);
    expect(count("threads")).toBe(sizes.threads);

    const member = {
      kind: "user" as const,
      userId: stored.memberIds[0]!,
      groupId: 2,
      sessionId: 0,
    };
    const list = (await execute(ctx, getOperation("threads.list"), member, {
      nodeId: stored.bigForumIds[0]!,
      limit: 20,
    })) as { items: unknown[] };
    expect(list.items.length).toBeGreaterThan(0);
    const posts = (await execute(ctx, getOperation("posts.list"), member, {
      threadId: stored.bigThreadIds[0]!,
      page: 1,
      limit: 20,
    })) as { items: unknown[] };
    expect(posts.items.length).toBeGreaterThan(0);
    const found = (await execute(ctx, getOperation("search.query"), member, {
      q: stored.searchTerms.common[0]!,
      limit: 20,
    })) as { items: unknown[] };
    expect(found.items.length).toBeGreaterThan(0);
  } finally {
    closeContext(ctx);
  }
});
