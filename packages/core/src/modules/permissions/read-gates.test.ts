import { describe, expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, NotFoundError } from "../../errors";
import { PERMISSIONS } from "../../permissions";
import { fillPosts, type World, world } from "../feed/fixtures.test";
import { ownThreadSql } from "../forums";
import { atomFeed, seoForThread, sitemapEntries } from "../seo";
import { setEntry } from "./group-fixture";

const GUESTS = 1;
const MEMBERS = 2;
const BASE = "https://forum.example.test";

/** Takes the permission from members and guests in the open forum (staff keep it). */
function close(w: World, key: "forum.viewOthers" | "forum.viewContent" | "forum.react") {
  for (const group of [GUESTS, MEMBERS]) setEntry(w.ctx, group, key, -1, w.open.id);
}
const ids = (items: { id: number }[]) => items.map((item) => item.id);

describe("registry shapes", () => {
  test("the two gates are open to everyone and reacting to posters by default", () => {
    expect(PERMISSIONS["forum.viewOthers"].defaults).toMatchObject({ guest: "allow" });
    expect(PERMISSIONS["forum.viewContent"].defaults).toMatchObject({ guest: "allow" });
    expect(PERMISSIONS["forum.react"].defaults).toMatchObject({ registered: "allow" });
    for (const id of ["forum.viewOthers", "forum.viewContent", "forum.react"] as const)
      expect(PERMISSIONS[id].scope).toBe("node");
  });
});

describe("forum.viewOthers", () => {
  async function scenario() {
    const w = world();
    const mine = await w.thread(w.alice, w.open.id, "Mine", "Alice text");
    const theirs = await w.thread(w.bob, w.open.id, "Theirs", "Bob text");
    const reply = await w.reply(w.alice, theirs.thread.id, "Alice reply");
    await w.call("bookmarks.set", w.alice, {
      contentType: "thread",
      contentId: theirs.thread.id,
      bookmarked: true,
    });
    await w.call("threads.watch", w.alice, { threadId: theirs.thread.id });
    close(w, "forum.viewOthers");
    return { w, mine, theirs, reply };
  }

  test("a forum lists only the viewer's own threads, staff still list all", async () => {
    const { w, mine, theirs } = await scenario();
    const own = await w.call("threads.list", w.alice, { nodeId: w.open.id });
    expect(ids(own.items)).toEqual([mine.thread.id]);
    expect(ids((await w.call("threads.list", w.mod, { nodeId: w.open.id })).items).sort()).toEqual(
      [mine.thread.id, theirs.thread.id].sort(),
    );
    expect((await w.call("threads.list", GUEST, { nodeId: w.open.id })).items).toEqual([]);
    // Sticky threads and the prefix filter follow the same rule.
    await w.call("threads.setSticky", w.mod, { threadId: theirs.thread.id, isSticky: true });
    await w.call("threads.setSticky", w.mod, { threadId: mine.thread.id, isSticky: true });
    const sticky = await w.call("threads.list", w.alice, { nodeId: w.open.id });
    expect(ids(sticky.sticky)).toEqual([mine.thread.id]);
  });

  test("a thread of another member is not found, its posts too", async () => {
    const { w, mine, theirs, reply } = await scenario();
    await expect(w.call("threads.get", w.alice, { threadId: theirs.thread.id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(w.call("posts.list", w.alice, { threadId: theirs.thread.id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(w.call("posts.get", w.alice, { postId: reply.id })).rejects.toThrow(NotFoundError);
    await expect(
      w.call("posts.create", w.alice, { threadId: theirs.thread.id, body: "More" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      w.call("seo.thread", w.alice, {
        threadId: theirs.thread.id,
        requestedPath: "",
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toThrow(NotFoundError);
    // Their own thread, and the posts others made in it, stay open to the author.
    await w.call("threads.get", w.alice, { threadId: mine.thread.id });
    await w.reply(w.mod, mine.thread.id, "Moderator in Alice's thread");
    expect((await w.call("posts.list", w.alice, { threadId: mine.thread.id })).items).toHaveLength(
      2,
    );
    await w.call("threads.get", w.mod, { threadId: theirs.thread.id });
  });

  test("the forum's newest post is not shown to a viewer who cannot open it", async () => {
    const { w } = await scenario();
    const forum = (viewer: Parameters<typeof w.call>[1]) =>
      w.call("nodes.get", viewer, { nodeId: w.open.id });
    expect((await forum(w.alice)).node.lastPost).toBeNull();
    expect((await forum(w.mod)).node.lastPost).not.toBeNull();
  });

  test("the feed, rankings, search, bookmarks and watches leave the others out", async () => {
    const { w, mine, theirs } = await scenario();
    const latest = await w.call("feed.list", w.alice, { scope: "latest", limit: 20 });
    const threadsInFeed = latest.items.flatMap((item: { thread?: { id: number } }) =>
      item.thread ? [item.thread.id] : [],
    );
    expect(threadsInFeed).toContain(mine.thread.id);
    expect(threadsInFeed).not.toContain(theirs.thread.id);
    const ranked = await w.call("threads.ranked", w.alice, { by: "latestThreads", limit: 20 });
    expect(ids(ranked.items)).toEqual([]);
    expect(
      ids((await w.call("threads.ranked", w.mod, { by: "latestThreads", limit: 20 })).items),
    ).toContain(theirs.thread.id);
    const found = await w.call("search.query", w.alice, { q: "Bob", limit: 20 });
    expect(found.items).toEqual([]);
    expect(
      (await w.call("search.query", w.alice, { q: "Alice", limit: 20 })).items.length,
    ).toBeGreaterThan(0);
    const bookmarks = await w.call("bookmarks.list", w.alice, { limit: 20 });
    expect(JSON.stringify(bookmarks)).not.toContain("Theirs");
    const watches = await w.call("watches.listThreads", w.alice, { limit: 20 });
    expect(watches.items).toEqual([]);
    const byBob = await w.call("threads.byAuthor", w.alice, { userId: w.bobUser.id, limit: 20 });
    expect(byBob.items).toEqual([]);
  });

  test("a staff pick in such a forum is shown only to those who may open it", async () => {
    const w = world();
    const theirs = await w.thread(w.bob, w.open.id, "Pick", "Bob text");
    await w.call("threads.setFeatured", w.mod, { threadId: theirs.thread.id, isFeatured: true });
    expect((await w.call("threads.featured", w.alice, { limit: 10 })).items).toHaveLength(1);
    close(w, "forum.viewOthers");
    expect((await w.call("threads.featured", w.alice, { limit: 10 })).items).toHaveLength(0);
    expect((await w.call("threads.featured", w.mod, { limit: 10 })).items).toHaveLength(1);
  });

  test("the public pages leave the forum out", async () => {
    const w = world();
    const theirs = await w.thread(w.bob, w.open.id, "Public", "Bob text");
    const feed = () => atomFeed(w.ctx, BASE, "Forum");
    const sitemap = () => [...sitemapEntries(w.ctx, BASE, "thread")].map((entry) => entry.id);
    expect(feed()).toContain("Public");
    expect(sitemap()).toContain(theirs.thread.id);
    close(w, "forum.viewOthers");
    expect(feed()).not.toContain("Public");
    expect(sitemap()).not.toContain(theirs.thread.id);
    expect(() => atomFeed(w.ctx, BASE, "Forum", w.open.id)).toThrow(NotFoundError);
  });

  test("the own-threads listing uses the author index", () => {
    const w = world();
    const page = [w.open.id, 0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 21, 5];
    expectNoTableScan(w.ctx, ownThreadSql.threadPage, page, { allowTempBTree: true });
    expectNoTableScan(w.ctx, ownThreadSql.sticky, [w.open.id, 0, 0, 5], { allowTempBTree: true });
    expectNoTableScan(w.ctx, ownThreadSql.threadPageByPrefix, [...page, 3], {
      allowTempBTree: true,
    });
    expectNoTableScan(w.ctx, ownThreadSql.stickyByPrefix, [w.open.id, 0, 0, 5, 3], {
      allowTempBTree: true,
    });
  });
});

describe("forum.viewContent", () => {
  async function scenario() {
    const w = world();
    const mine = await w.thread(w.alice, w.open.id, "Mine", "Alice secret text");
    const theirs = await w.thread(w.bob, w.open.id, "Theirs", "Bob secret text");
    const reply = await w.reply(w.alice, theirs.thread.id, "Alice reply");
    await w.call("bookmarks.set", w.alice, {
      contentType: "thread",
      contentId: theirs.thread.id,
      bookmarked: true,
    });
    close(w, "forum.viewContent");
    return { w, mine, theirs, reply };
  }

  test("titles are listed, the start of the opening post is not", async () => {
    const { w, mine, theirs } = await scenario();
    const list = await w.call("threads.list", w.alice, { nodeId: w.open.id });
    const byId = new Map(
      list.items.map((item: { id: number; title: string; excerpt: string }) => [item.id, item]),
    ) as Map<number, { title: string; excerpt: string }>;
    expect(byId.get(theirs.thread.id)).toMatchObject({ title: "Theirs", excerpt: "" });
    expect(byId.get(mine.thread.id)!.excerpt).toContain("Alice");
    const staff = await w.call("threads.list", w.mod, { nodeId: w.open.id });
    expect(JSON.stringify(staff)).toContain("Bob secret");
    expect(JSON.stringify(list)).not.toContain("Bob secret");
  });

  test("the thread is told apart from its text: the page can show the title and say so", async () => {
    const { w, theirs } = await scenario();
    const got = await w.call("threads.get", w.alice, { threadId: theirs.thread.id });
    expect(got.thread.title).toBe("Theirs");
    expect(got.thread.excerpt).toBe("");
    expect(got.permissions.canReply).toBe(false);
    expect(got.resolvedPermissions["forum.viewContent"]).toBe(false);
    expect(got.seo.description).toBe("");
    await expect(w.call("posts.list", w.alice, { threadId: theirs.thread.id })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      w.call("posts.create", w.alice, { threadId: theirs.thread.id, body: "More" }),
    ).rejects.toThrow(ForbiddenError);
    await w.call("posts.list", w.mod, { threadId: theirs.thread.id });
  });

  test("a member still reads what they wrote, and nothing of what others wrote", async () => {
    const { w, mine, theirs, reply } = await scenario();
    const own = await w.call("posts.get", w.alice, { postId: reply.id });
    expect(own.bodyHtml).toContain("Alice reply");
    await w.call("posts.update", w.alice, { postId: reply.id, body: "Edited" });
    await expect(w.call("posts.get", w.alice, { postId: theirs.post.id })).rejects.toThrow(
      ForbiddenError,
    );
    // The whole list of her own thread is refused too: the posts of a thread come as one.
    await expect(w.call("posts.list", w.alice, { threadId: mine.thread.id })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      w.call("reactions.set", w.carol, {
        contentType: "post",
        contentId: theirs.post.id,
        reactionTypeId: 1,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  test("the feed, search and bookmarks carry no text from the forum", async () => {
    const { w, theirs } = await scenario();
    const latest = await w.call("feed.list", w.alice, { scope: "latest", limit: 20 });
    expect(JSON.stringify(latest)).not.toContain("Bob secret");
    // Alice's own reply is hers to read; nothing Bob wrote is listed.
    const authors = latest.items.flatMap((item: { post?: { author: { id: number } } }) =>
      item.post ? [item.post.author.id] : [],
    );
    expect(authors).toContain(w.aliceUser.id);
    expect(authors).not.toContain(w.bobUser.id);
    void theirs;
    const body = await w.call("search.query", w.alice, { q: "secret", limit: 20 });
    expect(JSON.stringify(body)).not.toContain("Bob secret");
    expect(
      body.items.map((item: { post: { author: { id: number } } }) => item.post.author.id),
    ).not.toContain(w.bobUser.id);
    // A search by title still finds the thread, with no text.
    const byTitle = await w.call("search.query", w.alice, {
      q: "Theirs",
      titlesOnly: true,
      limit: 20,
    });
    expect(byTitle.items).toHaveLength(1);
    expect(byTitle.items[0].thread.id).toBe(theirs.thread.id);
    expect(byTitle.items[0].post.excerpt).toBe("");
    const bookmarks = await w.call("bookmarks.list", w.alice, { limit: 20 });
    expect(JSON.stringify(bookmarks)).toContain("Theirs");
    expect(JSON.stringify(bookmarks)).not.toContain("Bob secret");
    const media = await w.call("media.list", w.alice, { limit: 20 });
    expect(media.items).toEqual([]);
  });

  test("a long thread is closed as a whole and the public pages carry nothing", async () => {
    const w = world();
    const theirs = await w.thread(w.bob, w.open.id, "Public", "Bob public text");
    fillPosts(w.ctx, theirs.thread.id, w.bobUser.id, 3);
    const feed = () => atomFeed(w.ctx, BASE, "Forum");
    expect(feed()).toContain("Bob public text");
    close(w, "forum.viewContent");
    expect(feed()).not.toContain("Public");
    expect([...sitemapEntries(w.ctx, BASE, "thread")].map((entry) => entry.id)).not.toContain(
      theirs.thread.id,
    );
    const seo = seoForThread(w.ctx, GUEST, theirs.thread.id);
    expect(seo.robots).toBe("noindex,follow");
    expect(seo.jsonLd).toEqual([]);
    expect(seo.description).not.toContain("Bob public");
  });
});

describe("forum.react", () => {
  test("reacting to a post needs the permission in its forum, besides the site-wide one", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "T", "Text");
    const input = { contentType: "post", contentId: t.post.id, reactionTypeId: 1 };
    await w.call("reactions.set", w.bob, input);
    await w.call("reactions.remove", w.bob, { contentType: "post", contentId: t.post.id });
    close(w, "forum.react");
    await expect(w.call("reactions.set", w.bob, input)).rejects.toThrow(ForbiddenError);
    // Another forum is untouched, and staff keep it where the group was only taken from members.
    await w.call("reactions.set", w.mod, input);
    expect(
      (await w.call("threads.get", w.bob, { threadId: t.thread.id })).resolvedPermissions[
        "forum.react"
      ],
    ).toBe(false);
  });
});
