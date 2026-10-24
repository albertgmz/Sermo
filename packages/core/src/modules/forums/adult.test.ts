import { describe, expect, test } from "bun:test";
import { expectNoTableScan, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { type Actor, GUEST } from "../../actor";
import { invalidate } from "../../context";
import { AdultContentError, type AdultRefusal, NotFoundError } from "../../errors";
import { dispatchEvents } from "../../events";
import { world } from "../feed/fixtures.test";
import { adultFreeRankingSql } from "../feed/rankings";
import { runDueJobs } from "../jobs";
import { registerNotificationJobs } from "../notifications";
import { atomFeed, sitemapEntries } from "../seo";
import { updateSiteSettings } from "../settings";
import { adultFreeThreadSql } from "./index";

const BASE = "https://forum.example.test";
const titles = (items: { title: string }[]) => items.map((item) => item.title).sort();

/**
 * The +18 world on top of the feed's: a plain forum holding a plain thread and one its author
 * marked +18, a forum an administrator marked +18 (with a sub-forum) holding a thread, and one
 * viewer of each kind. The clock starts on 1 January 2026.
 */
async function adultWorld() {
  const w = world();
  registerNotificationJobs(w.ctx);
  const member = (name: string, birth?: [number, string], accepted = false) => {
    const user = insertUser(w.ctx, { username: name });
    w.ctx.sqlite
      .prepare(
        "UPDATE users SET birth_year = ?2, birthday_md = ?3, adult_accepted_at = ?4 WHERE id = ?1",
      )
      .run(user.id, birth?.[0] ?? null, birth?.[1] ?? null, accepted ? 1 : null);
    return { user, actor: userActor(user) };
  };
  const author = member("author", [1980, "03-04"], true);
  const adult = member("adult", [1990, "05-01"], true);
  const unaccepted = member("unaccepted", [1990, "05-01"]);
  const minor = member("minor", [2010, "05-01"], true);
  const undated = member("undated");
  const lounge = insertNode(w.ctx, { parentId: w.category.id, title: "Lounge" });
  const back = insertNode(w.ctx, { parentId: lounge.id, title: "Back room" });
  invalidate(w.ctx, "node_tree");
  const plain = await w.thread(author.actor, w.open.id, "Plain");
  const inLounge = await w.thread(author.actor, lounge.id, "Lounge talk");
  const inBack = await w.thread(author.actor, back.id, "Back talk");
  w.ctx.clock.advance(60_000);
  const marked = await w.call("threads.create", author.actor, {
    nodeId: w.open.id,
    title: "Marked",
    body: "Marked body",
    tags: ["topic"],
  });
  await w.call("threads.update", author.actor, { threadId: marked.thread.id, isAdult: true });
  await w.call("nodes.update", w.admin, { nodeId: lounge.id, settings: { isAdult: true } });
  const mode = (adultMode: boolean) => updateSiteSettings(w.ctx, w.admin, { adultMode });
  mode(true);
  /** Each viewer that may not see +18 content, with the reason the refusal gives. */
  const blocked: [string, Actor, AdultRefusal][] = [
    ["guest", GUEST, "guest"],
    ["minor", minor.actor, "minor"],
    ["undated", undated.actor, "birthDate"],
    ["unaccepted", unaccepted.actor, "acceptance"],
  ];
  return {
    ...w,
    author,
    adult,
    unaccepted,
    minor,
    undated,
    lounge,
    back,
    plain,
    inLounge,
    inBack,
    marked,
    mode,
    blocked,
    /** What `call` rejects with, for a +18 refusal: its reason. */
    async refusal(name: string, actor: Actor, input: object): Promise<AdultRefusal | "none"> {
      try {
        await w.call(name, actor, input);
        return "none";
      } catch (error) {
        if (error instanceof AdultContentError) {
          // The refusal is a forbidden error that says why in its one issue.
          expect(error.code).toBe("forbidden");
          expect(error.issues).toEqual([{ path: ["adult"], message: error.reason }]);
          return error.reason;
        }
        throw error;
      }
    },
  };
}

const ALL = ["Back talk", "Lounge talk", "Marked", "Plain"];

describe("+18 mode: direct access", () => {
  test("a marked thread, a marked forum and what is under it give the +18 refusal with its reason", async () => {
    const w = await adultWorld();
    for (const [, actor, reason] of w.blocked) {
      expect(await w.refusal("threads.get", actor, { threadId: w.marked.thread.id })).toBe(reason);
      expect(await w.refusal("posts.list", actor, { threadId: w.marked.thread.id })).toBe(reason);
      expect(await w.refusal("posts.get", actor, { postId: w.marked.post.id })).toBe(reason);
      expect(await w.refusal("threads.get", actor, { threadId: w.inBack.thread.id })).toBe(reason);
      expect(await w.refusal("nodes.get", actor, { nodeId: w.lounge.id })).toBe(reason);
      expect(await w.refusal("nodes.get", actor, { nodeId: w.back.id })).toBe(reason);
      expect(await w.refusal("threads.list", actor, { nodeId: w.lounge.id })).toBe(reason);
      expect(await w.refusal("threads.get", actor, { threadId: w.plain.thread.id })).toBe("none");
    }
    for (const actor of [w.adult.actor, w.author.actor])
      for (const threadId of [w.marked.thread.id, w.inLounge.thread.id, w.inBack.thread.id])
        expect(await w.refusal("threads.get", actor, { threadId })).toBe("none");
  });

  test("the marks are told on the thread and the forum", async () => {
    const w = await adultWorld();
    const marked = (await w.call("threads.get", w.adult.actor, { threadId: w.marked.thread.id }))
      .thread;
    expect([marked.isAdult, marked.adultByForum]).toEqual([true, false]);
    const back = (await w.call("threads.get", w.adult.actor, { threadId: w.inBack.thread.id }))
      .thread;
    expect([back.isAdult, back.adultByForum]).toEqual([false, true]);
    const nodes = (await w.call("nodes.list", w.adult.actor, {})).items;
    const node = (id: number) => nodes.find((item: { id: number }) => item.id === id);
    expect([node(w.lounge.id).settings.isAdult, node(w.lounge.id).adultByParent]).toEqual([
      true,
      false,
    ]);
    expect([node(w.back.id).settings.isAdult, node(w.back.id).adultByParent]).toEqual([
      false,
      true,
    ]);
  });

  test("with the mode off the marks change nothing", async () => {
    const w = await adultWorld();
    w.mode(false);
    for (const [, actor] of w.blocked) {
      expect(await w.refusal("threads.get", actor, { threadId: w.marked.thread.id })).toBe("none");
      expect(await w.refusal("threads.get", actor, { threadId: w.inBack.thread.id })).toBe("none");
      const list = await w.call("threads.list", actor, { nodeId: w.open.id, page: 1 });
      expect(titles(list.items)).toEqual(["Marked", "Plain"]);
    }
  });
});

describe("+18 mode: lists", () => {
  test("a forum's list leaves out marked threads, and its total and pages count without them", async () => {
    const w = await adultWorld();
    for (const [, actor] of w.blocked) {
      const page = await w.call("threads.list", actor, { nodeId: w.open.id, page: 1 });
      expect([titles(page.items), page.total]).toEqual([["Plain"], 1]);
      const second = await w.call("threads.list", actor, { nodeId: w.open.id, page: 2, limit: 1 });
      expect(second.items).toEqual([]);
    }
    const page = await w.call("threads.list", w.adult.actor, { nodeId: w.open.id, page: 1 });
    expect([titles(page.items), page.total]).toEqual([["Marked", "Plain"], 2]);
    // Its author keeps their own marked thread in the list.
    const own = await w.call("threads.list", w.author.actor, { nodeId: w.open.id, page: 1 });
    expect(titles(own.items)).toEqual(["Marked", "Plain"]);
  });

  test("the forum list leaves out marked forums, and a marked newest thread", async () => {
    const w = await adultWorld();
    for (const [, actor] of w.blocked) {
      const nodes = (await w.call("nodes.list", actor, {})).items;
      const ids = nodes.map((node: { id: number }) => node.id);
      expect(ids).not.toContain(w.lounge.id);
      expect(ids).not.toContain(w.back.id);
      expect(nodes.find((node: { id: number }) => node.id === w.open.id).lastPost).toBeNull();
    }
    const nodes = (await w.call("nodes.list", w.adult.actor, {})).items;
    expect(nodes.map((node: { id: number }) => node.id)).toContain(w.back.id);
    expect(nodes.find((node: { id: number }) => node.id === w.open.id).lastPost.threadTitle).toBe(
      "Marked",
    );
  });

  test("latest, the side lists, search and tags leave out what is marked", async () => {
    const w = await adultWorld();
    const surfaces = async (actor: Actor) => ({
      latest: titles(
        (await w.call("feed.list", actor, { scope: "latest" })).items.map(
          (item: { thread: { title: string } }) => item.thread,
        ),
      ),
      ranked: titles(
        (await w.call("threads.ranked", actor, { by: "latestPosts", limit: 10 })).items,
      ),
      created: titles(
        (await w.call("threads.ranked", actor, { by: "latestThreads", limit: 10 })).items,
      ),
      search: titles(
        (await w.call("search.query", actor, { q: "talk" })).items
          .concat((await w.call("search.query", actor, { q: "Marked" })).items)
          .map((item: { thread: { title: string } }) => item.thread),
      ),
      // A tag none of whose threads the viewer may see is not found, as any such tag.
      tag: titles(
        await w.call("tags.threads", actor, { name: "topic" }).then(
          (page) => page.items,
          (error) => {
            if (error instanceof NotFoundError) return [];
            throw error;
          },
        ),
      ),
    });
    for (const [, actor] of w.blocked)
      expect(await surfaces(actor)).toEqual({
        latest: ["Plain"],
        ranked: ["Plain"],
        created: ["Plain"],
        search: [],
        tag: [],
      });
    expect(await surfaces(w.adult.actor)).toEqual({
      latest: ALL,
      ranked: ALL,
      created: ALL,
      search: ["Back talk", "Lounge talk", "Marked"],
      tag: ["Marked"],
    });
    w.mode(false);
    expect((await surfaces(w.minor.actor)).latest).toEqual(ALL);
  });

  test("the member's own lists and the bookmarks leave out what is marked", async () => {
    const w = await adultWorld();
    w.mode(false);
    for (const threadId of [w.marked.thread.id, w.plain.thread.id])
      await w.call("bookmarks.set", w.minor.actor, {
        contentType: "thread",
        contentId: threadId,
        bookmarked: true,
      });
    w.mode(true);
    const bookmarks = await w.call("bookmarks.list", w.minor.actor, {});
    expect(bookmarks.items.map((item: { title: string }) => item.title)).toEqual(["Plain"]);
    const byAuthor = await w.call("threads.byAuthor", w.minor.actor, {
      userId: w.author.user.id,
    });
    expect(titles(byAuthor.items)).toEqual(["Plain"]);
    const all = await w.call("threads.byAuthor", w.adult.actor, { userId: w.author.user.id });
    expect(titles(all.items)).toEqual(ALL);
  });

  test("the Atom feed and the sitemap leave out marked threads, forums and profiles", async () => {
    const w = await adultWorld();
    await w.call("profiles.update", w.author.actor, { about: "Hello", isAdult: true });
    await w.call("profiles.update", w.adult.actor, { about: "Hi" });
    const feed = atomFeed(w.ctx, BASE, "Site");
    expect(feed).toContain("Plain");
    for (const title of ["Marked", "Lounge talk", "Back talk"]) expect(feed).not.toContain(title);
    const ids = (kind: "thread" | "node" | "profile") =>
      [...sitemapEntries(w.ctx, BASE, kind)].map((entry) => entry.id);
    expect(ids("thread")).toEqual([w.plain.thread.id]);
    expect(ids("node")).not.toContain(w.lounge.id);
    expect(ids("node")).not.toContain(w.back.id);
    expect(ids("profile")).toEqual([w.adult.user.id]);
    w.mode(false);
    expect(ids("thread").sort()).toEqual(
      [w.plain.thread.id, w.inLounge.thread.id, w.inBack.thread.id, w.marked.thread.id].sort(),
    );
    expect(ids("profile").sort()).toEqual([w.author.user.id, w.adult.user.id].sort());
  });
});

describe("+18 mode: profiles", () => {
  test("a marked profile, its wall and its card are kept from those who may not see it", async () => {
    const w = await adultWorld();
    await w.call("profiles.update", w.author.actor, { isAdult: true });
    await w.wall(w.adult.actor, w.author.user.id, "on the marked wall");
    await w.wall(w.adult.actor, w.adult.user.id, "on a plain wall");
    for (const [name, actor, reason] of w.blocked) {
      expect(await w.refusal("profiles.get", actor, { userId: w.author.user.id })).toBe(reason);
      // A guest is not shown walls at all.
      if (name !== "guest")
        expect(await w.refusal("profilePosts.list", actor, { userId: w.author.user.id })).toBe(
          reason,
        );
      const walls = (await w.call("feed.list", actor, { scope: "latest" })).items
        .filter((item: { type: string }) => item.type === "profilePost")
        .map((item: { profilePost: { profileUserId: number } }) => item.profilePost.profileUserId);
      expect(walls).not.toContain(w.author.user.id);
      const card = (await w.call("users.cards", actor, { userIds: [w.author.user.id] })).items[0];
      expect(card.restricted).toBe(true);
    }
    const profile = await w.call("profiles.get", w.adult.actor, { userId: w.author.user.id });
    expect(profile.isAdult).toBe(true);
    expect(
      (await w.call("users.cards", w.adult.actor, { userIds: [w.author.user.id] })).items[0]
        .restricted,
    ).toBe(false);
    // The member sees their own profile whatever their standing.
    await w.call("profiles.update", w.minor.actor, { isAdult: true });
    expect((await w.call("profiles.get", w.minor.actor, { userId: w.minor.user.id })).isAdult).toBe(
      true,
    );
  });

  test("staff mark a member's profile +18", async () => {
    const w = await adultWorld();
    await w.call("users.adminUpdateProfile", w.admin, { userId: w.adult.user.id, isAdult: true });
    expect(await w.refusal("profiles.get", w.minor.actor, { userId: w.adult.user.id })).toBe(
      "minor",
    );
  });
});

describe("+18 mode: alerts", () => {
  async function drain(ctx: Parameters<typeof dispatchEvents>[0]) {
    await dispatchEvents(ctx);
    await runDueJobs(ctx);
  }

  test("a reply in a marked thread alerts only watchers who may see it, and old alerts lose the title", async () => {
    const w = await adultWorld();
    w.mode(false);
    const watch = w.ctx.sqlite.prepare(
      "INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)",
    );
    for (const viewer of [w.minor, w.adult]) watch.run(viewer.user.id, w.marked.thread.id, 0);
    await drain(w.ctx);
    await w.reply(w.author.actor, w.marked.thread.id, "while the mode was off");
    await drain(w.ctx);
    // Read alerts are not merged into: the next reply is an alert of its own.
    for (const viewer of [w.minor, w.adult])
      await w.call("notifications.markRead", viewer.actor, { all: true });
    w.mode(true);
    await w.reply(w.author.actor, w.marked.thread.id, "with the mode on");
    await drain(w.ctx);
    const alerts = async (actor: Actor) =>
      (await w.call("notifications.list", actor, { limit: 10 })).items.map(
        (item: { contentTitle: string | null }) => item.contentTitle,
      );
    // The minor got the alert from before the mode was on, and it no longer names the thread.
    expect(await alerts(w.minor.actor)).toEqual([null]);
    expect(await alerts(w.adult.actor)).toEqual(["Marked", "Marked"]);
  });
});

describe("+18 mode: query plans", () => {
  test("the filtered list statements use their indexes", async () => {
    const w = await adultWorld();
    const big = Number.MAX_SAFE_INTEGER;
    const node = w.open.id;
    expectNoTableScan(w.ctx, adultFreeThreadSql.sticky, [node, 0, 0, 1]);
    expectNoTableScan(w.ctx, adultFreeThreadSql.threadPage, [node, 0, 0, big, big, 21, 1]);
    expectNoTableScan(w.ctx, adultFreeThreadSql.threadPageByPrefix, [
      node,
      0,
      0,
      big,
      big,
      21,
      1,
      1,
    ]);
    expectNoTableScan(w.ctx, adultFreeThreadSql.threadKey, [node, 0, 0, 1, 20]);
    expectNoTableScan(w.ctx, adultFreeThreadSql.threadKeyFromOldest, [node, 0, 0, 1, 20]);
    expectNoTableScan(w.ctx, adultFreeThreadSql.threadCountByPrefix, [node, 0, 0, 1, 1]);
    expectNoTableScan(w.ctx, adultFreeThreadSql.hiddenAdultCount, [node, 1, 0, 0]);
    expectNoTableScan(w.ctx, adultFreeRankingSql.latestPosts, [big, big, 20, 1]);
    expectNoTableScan(w.ctx, adultFreeRankingSql.latestThreads, [big, 20, 1]);
    expectNoTableScan(w.ctx, adultFreeRankingSql.latestPostsIn, ["[1,2]", 20, 1]);
    expectNoTableScan(w.ctx, adultFreeRankingSql.latestThreadsIn, ["[1,2]", 20, 1]);
  });
});
