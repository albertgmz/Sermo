import { describe, expect, test } from "bun:test";
import { expectNoTableScan } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { invalidate } from "../../context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { PERMISSIONS } from "../../permissions";
import { evaluate, loadFacts } from "../../shared/criteria";
import { type World, world } from "../feed/fixtures.test";
import { customMember, setEntry } from "../permissions/group-fixture";
import { sitemapEntries } from "../seo";
import { hubSql } from "./hub";
import { adminTagSql } from "./index";
import { tagSql } from "./store";

const MEMBERS = 2;
const GUESTS = 1;
const BASE = "https://forum.example.test";

const names = (items: { name: string }[]) => items.map((item) => item.name);
const titles = (items: { title: string }[]) => items.map((item) => item.title);

/** A thread of `actor` in the open forum with these tags and this body. */
function tagged(w: World, actor: World["alice"], title: string, tags: string[], body = "Text") {
  w.ctx.clock.advance(60_000);
  return w.call("threads.create", actor, { nodeId: w.open.id, title, body, tags });
}
const tagsOf = async (w: World, threadId: number, actor: World["alice"] = w.admin) =>
  (await w.call("threads.get", actor, { threadId })).tags as string[];
const tagRows = (w: World) =>
  w.ctx.sqlite
    .prepare<{ name: string; thread_count: number }, []>(
      "SELECT name, thread_count FROM tags ORDER BY name",
    )
    .all();
const tagCount = (w: World, userId: number) =>
  w.ctx.sqlite
    .prepare<{ tag_count: number }, [number]>("SELECT tag_count FROM users WHERE id = ?1")
    .get(userId)!.tag_count;
const bodyOf = (created: { post: { bodyHtml: string } }) => created.post.bodyHtml;

describe("registry", () => {
  test("members create and apply, staff manage", () => {
    expect(PERMISSIONS["tag.create"].defaults).toEqual({
      registered: "allow",
      moderator: "allow",
      admin: "allow",
    });
    expect(PERMISSIONS["tag.apply"].defaults).toEqual(PERMISSIONS["tag.create"].defaults);
    expect(PERMISSIONS["tag.manage"].defaults).toEqual({ moderator: "allow", admin: "allow" });
  });
});

describe("tags of a thread", () => {
  test("listed tags and the opening post's hashtags are the thread's tags", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "First", ["Rust", "#Café"], "Notes on #Zig and #rust");
    expect(await tagsOf(w, created.thread.id)).toEqual(["café", "rust", "zig"]);
    expect(bodyOf(created)).toContain('href="/tags/zig"');
    expect(bodyOf(created)).toContain('href="/tags/rust"');
    expect(tagRows(w)).toEqual([
      { name: "café", thread_count: 1 },
      { name: "rust", thread_count: 1 },
      { name: "zig", thread_count: 1 },
    ]);
    // The member who put the three tags has three to their name.
    expect(tagCount(w, w.aliceUser.id)).toBe(3);
  });

  test("replies' hashtags only link: they never tag the thread or make a tag", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "Thread", ["known"]);
    const reply = await w.call("posts.create", w.bob, {
      threadId: created.thread.id,
      body: "I like #known and #unknown",
    });
    expect(reply.bodyHtml).toContain('href="/tags/known"');
    expect(reply.bodyHtml).not.toContain("/tags/unknown");
    expect(reply.bodyHtml).toContain("#unknown");
    expect(await tagsOf(w, created.thread.id)).toEqual(["known"]);
    expect(names(tagRows(w))).toEqual(["known"]);
    // Another thread does not get the tag from a reply either.
    const other = await tagged(w, w.carol, "Other", []);
    await w.call("posts.create", w.bob, { threadId: other.thread.id, body: "#known" });
    expect(await tagsOf(w, other.thread.id)).toEqual([]);
  });

  test("a thread holds at most ten tags", async () => {
    const w = world();
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    await expect(tagged(w, w.alice, "Many", eleven)).rejects.toThrow(ValidationError);
    const ten = eleven.slice(0, 10);
    const created = await tagged(w, w.alice, "Ten", ten, "and #extra1 #extra2");
    // The hashtags found no room: they are plain text, not dead links.
    expect(await tagsOf(w, created.thread.id)).toEqual([...ten].sort());
    expect(bodyOf(created)).not.toContain("/tags/extra1");
    await expect(
      w.call("threads.update", w.alice, { threadId: created.thread.id, tags: [...ten, "t11"] }),
    ).rejects.toThrow(ValidationError);
  });

  test("a name that is no tag is refused", async () => {
    const w = world();
    for (const bad of ["two words", "12345", "a/b", "x".repeat(51)])
      await expect(tagged(w, w.alice, "Bad", [bad])).rejects.toThrow(ValidationError);
  });

  test("only the author, or staff, may set them", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "Mine", ["one"]);
    const threadId = created.thread.id;
    const set = (actor: World["alice"], tags: string[]) =>
      w.call("threads.update", actor, { threadId, tags });
    await expect(set(w.bob, ["two"])).rejects.toThrow(ForbiddenError);
    await expect(set(GUEST, ["two"])).rejects.toThrow(UnauthenticatedError);
    expect(await tagsOf(w, threadId)).toEqual(["one"]);
    await set(w.alice, ["one", "two"]);
    expect(await tagsOf(w, threadId)).toEqual(["one", "two"]);
    await set(w.mod, ["three"]);
    expect(await tagsOf(w, threadId)).toEqual(["three"]);
    await set(w.admin, []);
    expect(await tagsOf(w, threadId)).toEqual([]);
    // What the page shows the viewer.
    const can = async (actor: World["alice"]) =>
      (await w.call("threads.get", actor, { threadId })).permissions.canEditTags;
    expect([await can(w.alice), await can(w.bob), await can(w.mod), await can(GUEST)]).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  test("the author loses it when the thread is locked, staff keep it", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "Locked", ["a"]);
    await w.call("threads.setLocked", w.mod, { threadId: created.thread.id, isLocked: true });
    await expect(
      w.call("threads.update", w.alice, { threadId: created.thread.id, tags: ["b"] }),
    ).rejects.toThrow(ForbiddenError);
    await w.call("threads.update", w.mod, { threadId: created.thread.id, tags: ["b"] });
    expect(await tagsOf(w, created.thread.id)).toEqual(["b"]);
  });

  test("a title-only update does not need to touch the tags, and an empty update is refused", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "Before", ["keep"]);
    await w.call("threads.update", w.alice, { threadId: created.thread.id, title: "After" });
    expect(await tagsOf(w, created.thread.id)).toEqual(["keep"]);
    await expect(
      w.call("threads.update", w.alice, { threadId: created.thread.id }),
    ).rejects.toThrow(ValidationError);
    // Someone who may set tags but not the title can still set the tags.
    const manager = customMember(w.ctx, ["tag.manage", "tag.create", "site.view", "node.view"]);
    await w.call("threads.update", manager.actor, { threadId: created.thread.id, tags: ["x"] });
    await expect(
      w.call("threads.update", manager.actor, { threadId: created.thread.id, title: "No" }),
    ).rejects.toThrow(ForbiddenError);
  });

  test("a tag that no thread carries goes away", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "Solo", ["lonely", "shared"]);
    await tagged(w, w.bob, "Other", ["shared"]);
    await w.call("threads.update", w.alice, { threadId: created.thread.id, tags: ["shared"] });
    expect(names(tagRows(w))).toEqual(["shared"]);
    expect(tagCount(w, w.aliceUser.id)).toBe(1);
    await expect(w.call("tags.get", w.alice, { name: "lonely" })).rejects.toThrow(NotFoundError);
  });
});

describe("the opening post's hashtags follow its edits", () => {
  test("a hashtag removed from the opening post leaves the thread; tags set by hand stay", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "Edit", ["manual"], "About #alpha and #beta");
    expect(await tagsOf(w, created.thread.id)).toEqual(["alpha", "beta", "manual"]);
    const edit = (actor: World["alice"], body: string) =>
      w.call("posts.update", actor, { postId: created.post.id, body });
    await edit(w.alice, "About #beta and #gamma, and #manual");
    expect(await tagsOf(w, created.thread.id)).toEqual(["beta", "gamma", "manual"]);
    // #manual in the text does not make the hand-set tag go when the text drops it.
    await edit(w.alice, "Nothing now");
    expect(await tagsOf(w, created.thread.id)).toEqual(["manual"]);
    // A moderator's edit of the opening post counts too.
    await edit(w.mod, "Staff added #fromstaff");
    expect(await tagsOf(w, created.thread.id)).toEqual(["fromstaff", "manual"]);
  });

  test("a reply's edit never changes the tags, nor does an edit by someone who cannot set them", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "Thread", [], "Start #here");
    const reply = await w.call("posts.create", w.bob, { threadId: created.thread.id, body: "Hi" });
    await w.call("posts.update", w.bob, { postId: reply.id, body: "Now #here and #there" });
    expect(await tagsOf(w, created.thread.id)).toEqual(["here"]);
    // The author may edit the opening post but has lost the permission to tag.
    setEntry(w.ctx, MEMBERS, "tag.apply", -1);
    await w.call("posts.update", w.alice, {
      postId: created.post.id,
      body: "Start #here and #more",
    });
    expect(await tagsOf(w, created.thread.id, w.mod)).toEqual(["here"]);
    const html = (await w.call("posts.get", w.alice, { postId: created.post.id })).bodyHtml;
    expect(html).toContain('href="/tags/here"');
    expect(html).not.toContain("/tags/more");
  });
});

describe("permissions: create, apply, manage", () => {
  test("without tag.create a member uses tags that exist and an unknown #word stays text", async () => {
    const w = world();
    await tagged(w, w.bob, "Seed", ["exists"]);
    setEntry(w.ctx, MEMBERS, "tag.create", -1);
    const created = await tagged(w, w.alice, "Careful", ["exists"], "#exists #brandnew");
    expect(await tagsOf(w, created.thread.id)).toEqual(["exists"]);
    expect(bodyOf(created)).toContain('href="/tags/exists"');
    expect(bodyOf(created)).not.toContain("/tags/brandnew");
    expect(bodyOf(created)).toContain("#brandnew");
    await expect(tagged(w, w.alice, "Listed", ["exists", "brandnew"])).rejects.toThrow(
      ForbiddenError,
    );
    expect(names(tagRows(w))).toEqual(["exists"]);
    // Setting an unknown tag on a thread later is refused the same way, a known one is allowed.
    await expect(
      w.call("threads.update", w.alice, { threadId: created.thread.id, tags: ["brandnew"] }),
    ).rejects.toThrow(ForbiddenError);
    await w.call("threads.update", w.alice, { threadId: created.thread.id, tags: [] });
    await w.call("threads.update", w.alice, { threadId: created.thread.id, tags: ["Exists"] });
    // A moderator keeps the permission.
    await tagged(w, w.mod, "Staff", ["fresh"]);
    expect(names(tagRows(w))).toEqual(["exists", "fresh"]);
  });

  test("without tag.apply nothing is put on a thread, and hashtags only link", async () => {
    const w = world();
    await tagged(w, w.bob, "Seed", ["exists"]);
    setEntry(w.ctx, MEMBERS, "tag.apply", -1);
    await expect(tagged(w, w.alice, "No", ["exists"])).rejects.toThrow(ForbiddenError);
    const created = await tagged(w, w.alice, "Plain", [], "#exists #other");
    expect(await tagsOf(w, created.thread.id)).toEqual([]);
    expect(bodyOf(created)).toContain('href="/tags/exists"');
    expect(bodyOf(created)).not.toContain("/tags/other");
    await expect(
      w.call("threads.update", w.alice, { threadId: created.thread.id, tags: ["exists"] }),
    ).rejects.toThrow(ForbiddenError);
  });

  test("a guest cannot create a thread, a hand-made group holds exactly what it was given", async () => {
    const w = world();
    const base = ["site.view", "node.view", "forum.createThread", "forum.reply"];
    const apply = customMember(w.ctx, [...base, "tag.apply"]);
    const create = customMember(w.ctx, [...base, "tag.apply", "tag.create"]);
    const none = customMember(w.ctx, base);
    const make = (actor: World["alice"], tags: string[], body = "Text") =>
      w.call("threads.create", actor, { nodeId: w.open.id, title: "T", body, tags });
    await expect(make(GUEST, ["x"])).rejects.toThrow(UnauthenticatedError);
    // Nothing granted: no tags at all, but the thread itself is fine.
    await expect(make(none.actor, ["x"])).rejects.toThrow(ForbiddenError);
    expect((await make(none.actor, [], "#x")).thread.id).toBeGreaterThan(0);
    // apply without create: only tags that exist.
    await expect(make(apply.actor, ["x"])).rejects.toThrow(ForbiddenError);
    const made = await make(create.actor, ["x"]);
    expect(await tagsOf(w, made.thread.id)).toEqual(["x"]);
    const used = await make(apply.actor, ["x"], "#x #y");
    expect(await tagsOf(w, used.thread.id)).toEqual(["x"]);
    expect(bodyOf(used)).not.toContain("/tags/y");
  });

  test("managing tags needs tag.manage: guests, members refused; moderators and hand-made groups allowed", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "One", ["old"]);
    const tagId = tagRows(w).length && (await idOf(w, "old"));
    const manage = customMember(w.ctx, ["tag.manage"]);
    for (const [name, input] of [
      ["tags.list", {}],
      ["tags.rename", { tagId, name: "new" }],
      ["tags.merge", { tagId, intoTagId: tagId + 1 }],
      ["tags.delete", { tagId }],
    ] as const) {
      await expect(w.call(name, GUEST, input)).rejects.toThrow(UnauthenticatedError);
      await expect(w.call(name, w.alice, input)).rejects.toThrow(ForbiddenError);
    }
    expect((await w.call("tags.list", manage.actor, {})).items).toHaveLength(1);
    expect((await w.call("tags.rename", w.mod, { tagId, name: "newer" })).name).toBe("newer");
    expect(await tagsOf(w, created.thread.id)).toEqual(["newer"]);
    expect((await w.call("tags.list", w.admin, {})).items[0].aliases).toEqual(["old"]);
  });
});

async function idOf(w: World, name: string): Promise<number> {
  return w.ctx.sqlite
    .prepare<{ id: number }, [string]>("SELECT id FROM tags WHERE name = ?1")
    .get(name)!.id;
}

describe("the tag page", () => {
  test("lists threads by newest activity, cursor-paged, replies move a thread up", async () => {
    const w = world();
    const a = await tagged(w, w.alice, "A", ["news"]);
    await tagged(w, w.bob, "B", ["news"]);
    await tagged(w, w.carol, "C", ["news"]);
    await tagged(w, w.carol, "Other tag", ["else"]);
    const list = async (extra: object = {}) =>
      w.call("tags.threads", w.alice, { name: "news", ...extra });
    expect(titles((await list()).items)).toEqual(["C", "B", "A"]);
    await w.reply(w.bob, a.thread.id, "bump");
    expect(titles((await list()).items)).toEqual(["A", "C", "B"]);
    const first = await list({ limit: 2 });
    expect(titles(first.items)).toEqual(["A", "C"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list({ limit: 2, cursor: first.nextCursor });
    expect(titles(second.items)).toEqual(["B"]);
    expect(second.nextCursor).toBeNull();
  });

  test("the name is read like a hashtag: case, accents and the # do not matter", async () => {
    const w = world();
    await tagged(w, w.alice, "Coffee", ["café"]);
    for (const typed of ["café", "CAFÉ", "#Café", "café"])
      expect((await w.call("tags.threads", GUEST, { name: typed })).items).toHaveLength(1);
    await expect(w.call("tags.threads", GUEST, { name: "cafe" })).rejects.toThrow(NotFoundError);
    await expect(w.call("tags.threads", GUEST, { name: "no good" })).rejects.toThrow(NotFoundError);
  });

  test("a forum the viewer cannot open, and its tags, do not exist for them", async () => {
    const w = world();
    await w.call("threads.create", w.admin, {
      nodeId: w.secret.id,
      title: "Hidden",
      body: "x",
      tags: ["shh"],
    });
    await tagged(w, w.alice, "Shown", ["both"]);
    await w.call("threads.create", w.admin, {
      nodeId: w.secret.id,
      title: "Hidden too",
      body: "x",
      tags: ["both"],
    });
    for (const viewer of [GUEST, w.alice]) {
      await expect(w.call("tags.threads", viewer, { name: "shh" })).rejects.toThrow(NotFoundError);
      await expect(w.call("tags.get", viewer, { name: "shh" })).rejects.toThrow(NotFoundError);
      expect(titles((await w.call("tags.threads", viewer, { name: "both" })).items)).toEqual([
        "Shown",
      ]);
    }
    expect((await w.call("tags.threads", w.admin, { name: "shh" })).items).toHaveLength(1);
    expect(titles((await w.call("tags.threads", w.admin, { name: "both" })).items)).toEqual([
      "Hidden too",
      "Shown",
    ]);
  });

  test("where others' threads are closed only the viewer's own are listed", async () => {
    const w = world();
    await tagged(w, w.alice, "Alice's", ["topic"]);
    await tagged(w, w.bob, "Bob's", ["topic"]);
    for (const group of [GUESTS, MEMBERS])
      setEntry(w.ctx, group, "forum.viewOthers", -1, w.open.id);
    expect(titles((await w.call("tags.threads", w.alice, { name: "topic" })).items)).toEqual([
      "Alice's",
    ]);
    expect(titles((await w.call("tags.threads", w.mod, { name: "topic" })).items)).toEqual([
      "Bob's",
      "Alice's",
    ]);
    await expect(w.call("tags.threads", GUEST, { name: "topic" })).rejects.toThrow(NotFoundError);
  });

  test("closed text (viewContent) still lists the titles, without the excerpt", async () => {
    const w = world();
    await tagged(w, w.bob, "Bob's", ["topic"], "A secret opening");
    for (const group of [GUESTS, MEMBERS])
      setEntry(w.ctx, group, "forum.viewContent", -1, w.open.id);
    const page = await w.call("tags.threads", w.alice, { name: "topic" });
    expect(page.items[0]).toMatchObject({ title: "Bob's", excerpt: "" });
  });

  test("moderated and deleted threads show only to those who may see them", async () => {
    const w = world();
    await tagged(w, w.bob, "Live", ["topic"]);
    const hidden = await tagged(w, w.bob, "Hidden", ["topic"]);
    const pending = await tagged(w, w.carol, "Pending", ["topic"]);
    await w.call("threads.delete", w.mod, { threadId: hidden.thread.id });
    w.ctx.sqlite
      .prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1")
      .run(pending.thread.id);
    const seen = async (actor: World["alice"]) =>
      titles((await w.call("tags.threads", actor, { name: "topic" })).items);
    expect(await seen(w.alice)).toEqual(["Live"]);
    expect(await seen(GUEST)).toEqual(["Live"]);
    // The author sees their own thread under approval, nobody else's.
    expect(await seen(w.carol)).toEqual(["Pending", "Live"]);
    expect(await seen(w.mod)).toEqual(["Pending", "Hidden", "Live"]);
  });

  test("a merged thread is out of the page, the tag it held does not count it", async () => {
    const w = world();
    const target = await tagged(w, w.alice, "Target", ["topic"]);
    const source = await tagged(w, w.bob, "Source", ["topic"]);
    await w.call("threads.merge", w.mod, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    expect(titles((await w.call("tags.threads", w.alice, { name: "topic" })).items)).toEqual([
      "Target",
    ]);
  });

  test("a tag whose page has nothing for the viewer is not found", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "Soon gone", ["temp"]);
    await w.call("threads.delete", w.mod, { threadId: created.thread.id });
    await expect(w.call("tags.get", w.bob, { name: "temp" })).rejects.toThrow(NotFoundError);
    await expect(w.call("tags.threads", w.bob, { name: "temp" })).rejects.toThrow(NotFoundError);
    expect((await w.call("tags.get", w.mod, { name: "temp" })).name).toBe("temp");
  });

  test("a site closed to guests answers a guest with a sign-in", async () => {
    const w = world();
    await tagged(w, w.alice, "T", ["topic"]);
    setEntry(w.ctx, GUESTS, "site.view", -1);
    await expect(w.call("tags.get", GUEST, { name: "topic" })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(w.call("tags.threads", GUEST, { name: "topic" })).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  test("the page's query reads the tag's index, not the table", () => {
    const w = world();
    expectNoTableScan(
      w.ctx,
      hubSql(),
      [1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "[1]", "[]", "[]", "[]", 5, 21],
      { allowTempBTree: false },
    );
  });
});

describe("private conversations", () => {
  test("hashtags there link to tags that exist, make none, and never reach the tag page", async () => {
    const w = world();
    await tagged(w, w.alice, "Public", ["shared"]);
    const made = await w.call("conversations.create", w.alice, {
      title: "Private",
      recipientIds: [w.bobUser.id],
      body: "Talk about #shared and #secretplan",
    });
    expect(made.message.bodyHtml).toContain('href="/tags/shared"');
    expect(made.message.bodyHtml).not.toContain("/tags/secretplan");
    const reply = await w.call("conversations.reply", w.bob, {
      conversationId: made.conversation.id,
      body: "More #secretplan",
    });
    expect(reply.bodyHtml).not.toContain("/tags/secretplan");
    const edited = await w.call("conversations.updateMessage", w.alice, {
      messageId: made.message.id,
      body: "Edited #shared #secretplan",
    });
    expect(edited.bodyHtml).toContain('href="/tags/shared"');
    expect(edited.bodyHtml).not.toContain("/tags/secretplan");
    expect(names(tagRows(w))).toEqual(["shared"]);
    const page = await w.call("tags.threads", w.carol, { name: "shared" });
    expect(titles(page.items)).toEqual(["Public"]);
    await expect(w.call("tags.get", w.carol, { name: "secretplan" })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("renamed and merged tags", () => {
  test("the old name still reaches the tag, in links, hashtags and the page", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "T", ["colour"], "#colour");
    const tagId = await idOf(w, "colour");
    await w.call("tags.rename", w.mod, { tagId, name: "Color" });
    expect(await tagsOf(w, created.thread.id)).toEqual(["color"]);
    const viaOld = await w.call("tags.get", w.bob, { name: "colour" });
    expect(viaOld).toMatchObject({ name: "color", redirect: true });
    expect((await w.call("tags.get", w.bob, { name: "color" })).redirect).toBe(false);
    expect((await w.call("tags.threads", w.bob, { name: "colour" })).items).toHaveLength(1);
    // Typing the old name tags with the current one, once.
    const second = await tagged(w, w.bob, "T2", ["colour"], "#colour #COLOR");
    expect(await tagsOf(w, second.thread.id)).toEqual(["color"]);
    expect(bodyOf(second)).toContain('href="/tags/color"');
    await w.call("threads.update", w.bob, { threadId: second.thread.id, tags: ["colour", "x"] });
    expect(await tagsOf(w, second.thread.id)).toEqual(["color", "x"]);
    expect(tagRows(w).find((row) => row.name === "color")!.thread_count).toBe(2);
  });

  test("a name another tag holds, as a name or an old name, cannot be taken", async () => {
    const w = world();
    await tagged(w, w.alice, "T", ["one", "two"]);
    const one = await idOf(w, "one");
    const two = await idOf(w, "two");
    await expect(w.call("tags.rename", w.mod, { tagId: one, name: "two" })).rejects.toThrow(
      ConflictError,
    );
    await w.call("tags.rename", w.mod, { tagId: one, name: "uno" });
    await expect(w.call("tags.rename", w.mod, { tagId: two, name: "one" })).rejects.toThrow(
      ConflictError,
    );
    // Its own old name is free for it again.
    expect((await w.call("tags.rename", w.mod, { tagId: one, name: "one" })).aliases).toEqual([
      "uno",
    ]);
    await expect(w.call("tags.rename", w.mod, { tagId: one, name: "bad name" })).rejects.toThrow(
      ValidationError,
    );
  });

  test("merging moves the threads, keeps the counters right and leaves aliases", async () => {
    const w = world();
    const both = await tagged(w, w.alice, "Both", ["from", "into"]);
    const onlyFrom = await tagged(w, w.bob, "From", ["from"]);
    const from = await idOf(w, "from");
    const into = await idOf(w, "into");
    await w.call("tags.rename", w.mod, { tagId: from, name: "source" });
    const merged = await w.call("tags.merge", w.mod, { tagId: from, intoTagId: into });
    expect(merged).toMatchObject({ name: "into", threadCount: 2 });
    expect(merged.aliases.sort()).toEqual(["from", "source"]);
    expect(await tagsOf(w, both.thread.id)).toEqual(["into"]);
    expect(await tagsOf(w, onlyFrom.thread.id)).toEqual(["into"]);
    expect(names(tagRows(w))).toEqual(["into"]);
    // Alice put two tags on one thread, one of which became a duplicate and went; Bob has one.
    expect(tagCount(w, w.aliceUser.id)).toBe(1);
    expect(tagCount(w, w.bobUser.id)).toBe(1);
    expect((await w.call("tags.get", w.carol, { name: "from" })).redirect).toBe(true);
    await expect(w.call("tags.merge", w.mod, { tagId: into, intoTagId: into })).rejects.toThrow(
      ValidationError,
    );
    await expect(w.call("tags.merge", w.mod, { tagId: 9999, intoTagId: into })).rejects.toThrow(
      NotFoundError,
    );
  });

  test("deleting a tag takes it off its threads and out of the counters", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "T", ["gone", "stays"]);
    await w.call("tags.delete", w.mod, { tagId: await idOf(w, "gone") });
    expect(await tagsOf(w, created.thread.id)).toEqual(["stays"]);
    expect(tagCount(w, w.aliceUser.id)).toBe(1);
    await expect(w.call("tags.get", w.alice, { name: "gone" })).rejects.toThrow(NotFoundError);
    await expect(w.call("tags.delete", w.mod, { tagId: 9999 })).rejects.toThrow(NotFoundError);
    const log = w.ctx.sqlite
      .prepare<{ action: string }, []>("SELECT action FROM moderator_log ORDER BY id")
      .all()
      .map((row) => row.action);
    expect(log).toContain("tag.delete");
  });

  test("the admin list is by name, filtered by prefix, cursor-paged", async () => {
    const w = world();
    await tagged(w, w.alice, "T", ["alpha", "alps", "beta", "ácido", "gamma"]);
    const all = await w.call("tags.list", w.mod, { limit: 3 });
    expect(names(all.items)).toEqual(["alpha", "alps", "beta"]);
    const rest = await w.call("tags.list", w.mod, { limit: 3, cursor: all.nextCursor });
    expect(names(rest.items)).toEqual(["gamma", "ácido"]);
    expect(rest.nextCursor).toBeNull();
    expect(names((await w.call("tags.list", w.mod, { query: "#AL" })).items)).toEqual([
      "alpha",
      "alps",
    ]);
    expect(all.items[0]).toMatchObject({ threadCount: 1, aliases: [] });
  });
});

describe("the added-tags criterion", () => {
  test("a counter on the member, up and down with the tags they put on threads", async () => {
    const w = world();
    const rule = {
      match: "all" as const,
      conditions: [{ criterion: "tags_added_at_least", value: 3 }],
    };
    const holds = (userId: number) => {
      const facts = loadFacts(w.ctx, [userId], [rule]).get(userId)!;
      return evaluate(rule, facts);
    };
    const created = await tagged(w, w.alice, "T", ["a", "b"]);
    expect(holds(w.aliceUser.id)).toBe(false);
    await w.call("threads.update", w.alice, { threadId: created.thread.id, tags: ["a", "b", "c"] });
    expect(holds(w.aliceUser.id)).toBe(true);
    // A staff member who tags someone else's thread earns the count, the author does not lose it.
    await w.call("threads.update", w.mod, {
      threadId: created.thread.id,
      tags: ["a", "b", "c", "d"],
    });
    expect(tagCount(w, w.aliceUser.id)).toBe(3);
    expect(tagCount(w, actorUserId(w.mod)!)).toBe(1);
    await w.call("threads.update", w.alice, { threadId: created.thread.id, tags: ["a"] });
    expect(holds(w.aliceUser.id)).toBe(false);
    expect(tagCount(w, w.aliceUser.id)).toBe(1);
    expect(tagCount(w, actorUserId(w.mod)!)).toBe(0);
  });

  test("it is a cheap criterion: a promotion asks for it without a history scan", () => {
    const w = world();
    const sql = w.ctx.sqlite
      .prepare<{ detail: string }, []>(
        "EXPLAIN QUERY PLAN SELECT u.tag_count FROM users u WHERE u.id IN (SELECT value FROM json_each('[1]'))",
      )
      .all();
    expect(sql.map((row) => row.detail).join("\n")).not.toContain("SCAN u");
  });
});

describe("hard delete", () => {
  test("a thread removed for good takes its tag rows and the tags only it carried", async () => {
    const w = world();
    const created = await tagged(w, w.alice, "Doomed", ["only", "common"]);
    await tagged(w, w.bob, "Other", ["common"]);
    await w.call("threads.delete", w.mod, { threadId: created.thread.id });
    await w.call("threads.hardDelete", w.admin, { threadId: created.thread.id, reason: "gone" });
    expect(tagRows(w)).toEqual([{ name: "common", thread_count: 1 }]);
    expect(tagCount(w, w.aliceUser.id)).toBe(0);
    expect(
      w.ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM thread_tags").get()!.n,
    ).toBe(1);
  });
});

describe("SEO", () => {
  async function threads(w: World, count: number, tags = ["topic"]) {
    for (let i = 0; i < count; i++) await tagged(w, w.alice, `Thread ${i}`, tags);
  }
  const get = (w: World, actor: World["alice"] = GUEST, name = "topic", requestedPath = "") =>
    w.call("tags.get", actor, { name, requestedPath });

  test("title, description, canonical, and noindex below three threads open to guests", async () => {
    const w = world();
    await threads(w, 2);
    const small = (await get(w)).seo;
    expect(small).toMatchObject({
      canonical: "http://localhost:3000/tags/topic",
      robots: "noindex,follow",
      redirect: false,
    });
    expect(small.title).toContain("#topic");
    expect(small.description).toContain("#topic");
    await threads(w, 1);
    expect((await get(w)).seo.robots).toBe("index,follow");
    // Threads only members can open do not count towards the index.
    const w2 = world();
    await threads(w2, 3);
    for (const id of [1, 2, 3])
      w2.ctx.sqlite.prepare("UPDATE threads SET node_id = ?1 WHERE id = ?2").run(w2.secret.id, id);
    invalidate(w2.ctx, "node_tree");
    expect((await get(w2, w2.admin)).seo.robots).toBe("noindex,follow");
  });

  test("the canonical address carries the encoded name; a different path redirects", async () => {
    const w = world();
    await threads(w, 3, ["café"]);
    const page = await get(w, GUEST, "Café", "/tags/caf%C3%A9");
    expect(page.seo.canonical).toBe("http://localhost:3000/tags/caf%C3%A9");
    expect(page.redirect).toBe(false);
    expect((await get(w, GUEST, "café", "/tags/CAF%C3%89")).redirect).toBe(true);
    expect((await get(w, GUEST, "Café", "/tags/Caf%C3%A9")).seo.redirect).toBe(true);
  });

  test("the sitemap lists a tag only when guests can open at least three of its threads", async () => {
    const w = world();
    await threads(w, 2, ["small"]);
    await threads(w, 3, ["big"]);
    const entries = () => [...sitemapEntries(w.ctx, BASE, "tag")].map((entry) => entry.url);
    expect(entries()).toEqual([`${BASE}/tags/big`]);
    // Close the forum to guests: the tag leaves the sitemap.
    setEntry(w.ctx, GUESTS, "forum.viewOthers", -1, w.open.id);
    expect(entries()).toEqual([]);
    setEntry(w.ctx, GUESTS, "forum.viewOthers", 0, w.open.id);
    expect(entries()).toEqual([`${BASE}/tags/big`]);
    setEntry(w.ctx, GUESTS, "site.view", -1);
    expect(entries()).toEqual([]);
  });

  test("the sitemap index names the tag sitemap only when it has entries", async () => {
    const w = world();
    const { sitemapIndex } = await import("../seo");
    expect(sitemapIndex(w.ctx, BASE)).not.toContain("tag-1.xml");
    await threads(w, 3);
    expect(sitemapIndex(w.ctx, BASE)).toContain("/sitemaps/tag-1.xml");
  });
});

describe("the statements read indexes", () => {
  test("names, aliases, a thread's tags and the admin list", () => {
    const w = world();
    expectNoTableScan(w.ctx, tagSql.resolve, ['["a","b"]']);
    expectNoTableScan(w.ctx, tagSql.idByName, ["a"]);
    expectNoTableScan(w.ctx, tagSql.idByAlias, ["a"]);
    expectNoTableScan(w.ctx, tagSql.rows, [1]);
    expectNoTableScan(w.ctx, tagSql.names, [1], { allowTempBTree: true });
    expectNoTableScan(w.ctx, adminTagSql.list, ["", "", "\u{10FFFF}", 21]);
    expectNoTableScan(w.ctx, adminTagSql.aliases, ["[1]"], { allowTempBTree: true });
    expectNoTableScan(w.ctx, tagSql.dropUnused, ["[1]"]);
  });
});
