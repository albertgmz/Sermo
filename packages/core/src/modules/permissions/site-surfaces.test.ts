import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { bookmarksListOp, bookmarksSetOp } from "../bookmarks";
import { conversationsCreateOp } from "../conversations";
import { feedListOp } from "../feed/feed";
import { threadsCreateOp } from "../forums";
import { runDueJobs } from "../jobs";
import { usersCardsOp } from "../members";
import { usersBirthdaysOp, usersStaffOp } from "../members/directory";
import { standingsMonthOp, standingsWinnersOp } from "../members/standings";
import { profilePostsCreateOp } from "../profiles";
import { reactionsListOp, reactionsSetOp, reactionTypesCreateOp } from "../reactions";
import {
  atomFeed,
  llmsTxt,
  queueSeoEvents,
  registerSeoJobs,
  sitemapIndex,
  sitemapShard,
} from "../seo";
import { updateSiteSettings } from "../settings";
import { usersListFollowersOp, usersListFollowingOp } from "../social";
import { spoilersGetOp } from "../spoilers";
import { getFileRecord } from "../storage";

type Ctx = ReturnType<typeof createTestContext>;
const BASE = "https://forum.example.test";

function setEntry(ctx: Ctx, groupId: number, key: string, value: number) {
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, ?2 FROM permission_definitions WHERE key = ?3 ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
    )
    .run(groupId, value, key);
  ctx.sqlite
    .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
    .run();
}

async function world() {
  const ctx = createTestContext();
  ctx.config.siteBaseURL = BASE;
  const node = insertNode(ctx, { title: "Open forum" });
  invalidate(ctx, "node_tree");
  const author = insertUser(ctx);
  const authorActor = userActor(author);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  updateSiteSettings(ctx, admin, { indexNowKey: "example-key-123" });
  const made = await execute(ctx, threadsCreateOp, authorActor, {
    nodeId: node.id,
    title: "Public thread",
    body: "Body with a ||secret||",
  });
  await execute(ctx, profilePostsCreateOp, authorActor, { userId: author.id, body: "Wall post" });
  ctx.sqlite
    .prepare(
      "INSERT INTO content_spoilers (content_type, content_id, position, html) VALUES ('post', ?1, 0, 'secret')",
    )
    .run(made.post.id);
  const file = ctx.sqlite
    .prepare<{ id: number }, [number, number]>(
      "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('local', 'k' || ?1, 3, 'text/plain', 'h', ?2, 'attachment', 'public', 0) RETURNING id",
    )
    .get(made.post.id, author.id)!.id;
  ctx.sqlite
    .prepare(
      "INSERT INTO attachments (file_id, content_type, content_id, position, created_at) VALUES (?1, 'post', ?2, 0, 0)",
    )
    .run(file, made.post.id);
  return { ctx, node, author, authorActor, admin, made, file };
}

describe("a site closed to guests serves no public surface", () => {
  test("Atom feeds, sitemaps and llms.txt", async () => {
    const w = await world();
    expect(atomFeed(w.ctx, BASE, "Forum")).toContain("Public thread");
    expect(atomFeed(w.ctx, BASE, "Forum", w.node.id)).toContain("Public thread");
    expect(sitemapIndex(w.ctx, BASE)).toContain("<sitemap>");
    expect(sitemapShard(w.ctx, BASE, "thread", 1)).toContain("<url>");
    expect(llmsTxt(w.ctx, BASE)).toContain("Open forum");

    setEntry(w.ctx, 1, "site.view", -1);
    expect(() => atomFeed(w.ctx, BASE, "Forum")).toThrow(NotFoundError);
    expect(() => atomFeed(w.ctx, BASE, "Forum", w.node.id)).toThrow(NotFoundError);
    expect(sitemapIndex(w.ctx, BASE)).not.toContain("<sitemap>");
    for (const kind of ["node", "thread", "profile"] as const)
      expect(sitemapShard(w.ctx, BASE, kind, 1)).not.toContain("<url>");
    expect(() => llmsTxt(w.ctx, BASE)).toThrow(NotFoundError);
  });

  test("IndexNow announces nothing", async () => {
    const w = await world();
    const calls: string[][] = [];
    registerSeoJobs(w.ctx, (async (_input: unknown, init?: RequestInit) => {
      calls.push((JSON.parse(String(init?.body)) as { urlList: string[] }).urlList);
      return new Response("ok");
    }) as typeof fetch);
    setEntry(w.ctx, 1, "site.view", -1);
    queueSeoEvents(w.ctx);
    await runDueJobs(w.ctx);
    expect(calls).toHaveLength(0);
    expect(
      w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM indexnow_pending").get()!
        .n,
    ).toBe(0);
  });

  test("the SEO operations, spoilers and attachment downloads", async () => {
    const w = await world();
    const seo = [
      () => execute(w.ctx, getOperation("seo.node"), GUEST, { nodeId: w.node.id }),
      () => execute(w.ctx, getOperation("seo.thread"), GUEST, { threadId: w.made.thread.id }),
      () => execute(w.ctx, getOperation("seo.profile"), GUEST, { userId: w.author.id }),
    ];
    const spoiler = () =>
      execute(w.ctx, spoilersGetOp, GUEST, {
        contentType: "post",
        contentId: w.made.post.id,
        position: 0,
      });
    for (const read of seo) await read();
    expect((await spoiler()).html).toBe("secret");
    expect(getFileRecord(w.ctx, GUEST, w.file).id).toBe(w.file);

    setEntry(w.ctx, 1, "site.view", -1);
    for (const read of seo) await expect(read()).rejects.toThrow(UnauthenticatedError);
    await expect(spoiler()).rejects.toThrow(UnauthenticatedError);
    expect(() => getFileRecord(w.ctx, GUEST, w.file)).toThrow(NotFoundError);
    // A member of the same site reads them all.
    expect(getFileRecord(w.ctx, w.authorActor, w.file).id).toBe(w.file);
    await expect(
      execute(w.ctx, spoilersGetOp, w.authorActor, {
        contentType: "post",
        contentId: w.made.post.id,
        position: 0,
      }),
    ).resolves.toEqual({ html: "secret" });
  });
});

describe("a member whose groups lack site.view", () => {
  test("reads nothing of the site, yet draws their own card", async () => {
    const w = await world();
    const groupId = w.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Closed out', 10) RETURNING id",
      )
      .get()!.id;
    for (const key of [
      "node.view",
      "forum.viewOthers",
      "forum.viewContent",
      "profile.view",
      "member.viewList",
      "profilePost.view",
    ])
      setEntry(w.ctx, groupId, key, 1);
    const row = insertUser(w.ctx, { groupId });
    const actor = userActor(row);
    const reads: [string, () => Promise<unknown>][] = [
      ["users.staff", () => execute(w.ctx, usersStaffOp, actor, {})],
      ["users.birthdays", () => execute(w.ctx, usersBirthdaysOp, actor, {})],
      ["standings.month", () => execute(w.ctx, standingsMonthOp, actor, { month: "current" })],
      ["standings.winners", () => execute(w.ctx, standingsWinnersOp, actor, {})],
      ["users.cards", () => execute(w.ctx, usersCardsOp, actor, { userIds: [w.author.id] })],
      ["feed.list", () => execute(w.ctx, feedListOp, actor, { scope: "latest" })],
    ];
    for (const [, read] of reads) await expect(read()).rejects.toThrow(ForbiddenError);
    await expect(execute(w.ctx, usersCardsOp, actor, { userIds: [row.id] })).resolves.toBeTruthy();
    expect((await execute(w.ctx, bookmarksListOp, actor, { limit: 20 })).items).toEqual([]);
    setEntry(w.ctx, groupId, "site.view", 1);
    for (const [, read] of reads) await read();
  });

  test("the staff list, birthdays and standings also need member.viewList", async () => {
    const w = await world();
    const viewer = userActor(insertUser(w.ctx));
    const reads = [
      () => execute(w.ctx, usersStaffOp, viewer, {}),
      () => execute(w.ctx, usersBirthdaysOp, viewer, {}),
      () => execute(w.ctx, standingsMonthOp, viewer, { month: "current" }),
      () => execute(w.ctx, standingsWinnersOp, viewer, {}),
    ];
    for (const read of reads) await read();
    setEntry(w.ctx, 2, "member.viewList", 0);
    for (const read of reads) await expect(read()).rejects.toThrow(ForbiddenError);
  });

  test("the feed refuses a guest without site.view even where no forum is open to guests", async () => {
    const w = await world();
    setEntry(w.ctx, 1, "site.view", -1);
    setEntry(w.ctx, 1, "node.view", -1);
    await expect(execute(w.ctx, feedListOp, GUEST, { scope: "latest" })).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  test("removing a bookmark still works without bookmark.create", async () => {
    const w = await world();
    const reader = userActor(insertUser(w.ctx));
    const input = { contentType: "thread" as const, contentId: w.made.thread.id };
    await execute(w.ctx, bookmarksSetOp, reader, { ...input, bookmarked: true });
    setEntry(w.ctx, 2, "bookmark.create", 0);
    await execute(w.ctx, bookmarksSetOp, reader, { ...input, bookmarked: false });
    expect(
      w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM bookmarks").get()!.n,
    ).toBe(0);
  });
});

describe("more reads that follow site.view", () => {
  async function closedOut(w: Awaited<ReturnType<typeof world>>, grants: string[]) {
    const groupId = w.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Closed out', 10) RETURNING id",
      )
      .get()!.id;
    for (const key of [
      "node.view",
      "forum.viewOthers",
      "forum.viewContent",
      "profile.view",
      "reaction.viewList",
      ...grants,
    ])
      setEntry(w.ctx, groupId, key, 1);
    const row = insertUser(w.ctx, { groupId });
    return { groupId, row, actor: userActor(row) };
  }

  test("who reacted, and who follows whom", async () => {
    const w = await world();
    const type = await execute(w.ctx, reactionTypesCreateOp, w.admin, {
      title: "Like",
      emoji: "+",
      score: 1,
      position: 0,
    });
    const fan = userActor(insertUser(w.ctx));
    await execute(w.ctx, reactionsSetOp, fan, {
      contentType: "post",
      contentId: w.made.post.id,
      reactionTypeId: type.id,
    });
    const out = await closedOut(w, ["member.viewFollowing"]);
    const list = (actor: Parameters<typeof execute>[2]) =>
      execute(w.ctx, reactionsListOp, actor, {
        contentType: "post",
        contentId: w.made.post.id,
        limit: 20,
      });
    const followers = (actor: Parameters<typeof execute>[2]) =>
      execute(w.ctx, usersListFollowersOp, actor, { userId: w.author.id, limit: 20 });
    const following = (actor: Parameters<typeof execute>[2]) =>
      execute(w.ctx, usersListFollowingOp, actor, { userId: w.author.id, limit: 20 });
    expect((await list(GUEST)).items).toHaveLength(1);
    await followers(GUEST);
    await following(GUEST);

    setEntry(w.ctx, 1, "site.view", -1);
    for (const read of [list, followers, following])
      await expect(read(GUEST)).rejects.toThrow(UnauthenticatedError);
    for (const read of [list, followers, following])
      await expect(read(out.actor)).rejects.toThrow(ForbiddenError);
    // A closed-out member still reads the list of whom they follow themselves.
    await expect(
      execute(w.ctx, usersListFollowingOp, out.actor, { userId: out.row.id, limit: 20 }),
    ).rejects.toThrow(ForbiddenError);
    setEntry(w.ctx, out.groupId, "site.view", 1);
    for (const read of [list, followers, following]) await read(out.actor);
  });

  test("the holders of an award need member.viewList, an award and a member's awards need site.view", async () => {
    const w = await world();
    const award = (await execute(w.ctx, getOperation("awards.create"), w.admin, {
      name: "First",
      tier: "bronze",
    })) as { id: number };
    const reads = (actor: Parameters<typeof execute>[2]) => ({
      list: () => execute(w.ctx, getOperation("awards.list"), actor, {}),
      get: () => execute(w.ctx, getOperation("awards.get"), actor, { awardId: award.id }),
      holders: () =>
        execute(w.ctx, getOperation("awards.holders"), actor, { awardId: award.id, limit: 20 }),
      member: () => execute(w.ctx, getOperation("awards.member"), actor, { userId: w.author.id }),
      grants: () =>
        execute(w.ctx, getOperation("awards.memberGrants"), actor, {
          userId: w.author.id,
          limit: 20,
        }),
    });
    for (const read of Object.values(reads(GUEST))) await read();
    const out = await closedOut(w, ["member.viewList"]);
    for (const read of Object.values(reads(out.actor)))
      await expect(read()).rejects.toThrow(ForbiddenError);
    setEntry(w.ctx, out.groupId, "site.view", 1);
    for (const read of Object.values(reads(out.actor))) await read();
    setEntry(w.ctx, out.groupId, "member.viewList", 0);
    const after = reads(out.actor);
    await expect(after.holders()).rejects.toThrow(ForbiddenError);
    await after.member();
    await after.get();
  });

  test("a closed-out member still downloads the files of their conversations, not of posts", async () => {
    const w = await world();
    const out = await closedOut(w, ["conversation.receive"]);
    const talk = await execute(w.ctx, conversationsCreateOp, w.authorActor, {
      title: "Hi",
      recipientIds: [out.row.id],
      body: "with a file",
    });
    const file = w.ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('local', 'conv' || ?1, 3, 'text/plain', 'h', ?2, 'attachment', 'private', 0) RETURNING id",
      )
      .get(talk.message.id, w.author.id)!.id;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO attachments (file_id, content_type, content_id, position, created_at) VALUES (?1, 'conversation_message', ?2, 0, 0)",
      )
      .run(file, talk.message.id);
    expect(getFileRecord(w.ctx, out.actor, file).id).toBe(file);
    expect(() => getFileRecord(w.ctx, out.actor, w.file)).toThrow(NotFoundError);
  });
});
