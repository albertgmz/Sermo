import { afterEach, describe, expect, test } from "bun:test";
import {
  createKeyFromSession,
  expectNoTableScan,
  insertNode,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ACCEPTANCE_REQUIRED_PATH } from "../../contracts/terms";
import { ConflictError, ForbiddenError, type SermoError, UnauthenticatedError } from "../../errors";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { getAuth, resolveActor } from "../auth";
import { acceptanceSql } from "./acceptance";

afterEach(closeAll);

const ORIGIN = "http://localhost:3000";
let clients = 0;

/** Registers through Better Auth the way the web form does, optionally ticking the box. */
async function signUp(
  w: Awaited<ReturnType<typeof accounts>>,
  username: string,
  options: { accept?: boolean; ip?: string } = {},
) {
  const ip = options.ip ?? `198.51.100.${++clients}`;
  const response = await getAuth(w.ctx).handler(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, "x-sermo-client-ip": ip },
      body: JSON.stringify({
        name: username,
        username,
        email: `${username.toLowerCase()}@example.test`,
        password: PASSWORD,
        ...(options.accept === undefined ? {} : { acceptTerms: options.accept }),
      }),
    }),
  );
  expect(response.status).toBe(200);
  const id = Number(((await response.json()) as { user: { id: string } }).user.id);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return { id, cookie, actor: userActor({ id, groupId: 2 }) };
}

const isAcceptanceRefusal = (error: unknown) =>
  error instanceof ForbiddenError &&
  error.issues?.some((issue) => issue.path[0] === ACCEPTANCE_REQUIRED_PATH) === true;

async function outcome(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
    return null;
  } catch (error) {
    return error;
  }
}

async function world() {
  const w = await accounts();
  const admin = await w.register("Admin", 4);
  const moderator = await w.register("Moder", 3);
  const poster = await w.register("Poster");
  const other = await w.register("Other");
  const third = await w.register("Third");
  const node = insertNode(w.ctx, { title: "Forum", type: "forum" });
  invalidate(w.ctx, "node_tree");
  // Everything the member touches later is made before the pages are published.
  const theirs = await w.run("threads.create", other.actor, {
    nodeId: node.id,
    title: "Theirs",
    body: "Their first words",
  });
  const mine = await w.run("threads.create", poster.actor, {
    nodeId: node.id,
    title: "Mine",
    body: "My first words",
  });
  const wall = await w.run("profilePosts.create", poster.actor, {
    userId: poster.id,
    body: "On my wall",
  });
  const comment = await w.run("profileComments.create", poster.actor, {
    profilePostId: wall.id,
    body: "A comment",
  });
  const conversation = await w.run("conversations.create", poster.actor, {
    title: "Hello",
    recipientIds: [other.id],
    body: "First message",
  });
  const reactionTypeId = (await w.run("reactionTypes.list", GUEST)).items.find(
    (item: { isActive: boolean }) => item.isActive,
  ).id as number;
  const publish = (slug: "terms" | "rules", extra: object = {}) =>
    w.run("pages.save", admin.actor, { slug, title: slug, body: `The ${slug}`, ...extra });
  const pending = async (actor: object) =>
    (await w.run("auth.me", actor)).user.pendingAcceptance as { kind: string; version: number }[];
  const accept = async (actor: object) =>
    w.run("terms.accept", actor, { accept: await pending(actor) });
  const writes: [string, object][] = [
    ["threads.create", { nodeId: node.id, title: "New thread", body: "b" }],
    ["posts.create", { threadId: theirs.thread.id, body: "A reply" }],
    ["threads.update", { threadId: mine.thread.id, title: "Renamed" }],
    ["posts.update", { postId: mine.post.id, body: "Edited" }],
    ["profilePosts.create", { userId: poster.id, body: "Another wall post" }],
    ["profilePosts.update", { profilePostId: wall.id, body: "Edited wall post" }],
    ["profileComments.create", { profilePostId: wall.id, body: "Another comment" }],
    ["profileComments.update", { commentId: comment.id, body: "Edited comment" }],
    [
      "reactions.set",
      { contentType: "post", contentId: theirs.post.id, reactionTypeId: reactionTypeId },
    ],
    ["conversations.create", { title: "Another", recipientIds: [other.id], body: "b" }],
    ["conversations.reply", { conversationId: conversation.conversation.id, body: "A reply" }],
    [
      "conversations.addParticipants",
      { conversationId: conversation.conversation.id, userIds: [third.id] },
    ],
    ["conversations.updateMessage", { messageId: conversation.message.id, body: "Edited" }],
  ];
  const reads: [string, object][] = [
    ["threads.get", { threadId: theirs.thread.id }],
    ["posts.list", { threadId: theirs.thread.id }],
    ["profilePosts.list", { userId: poster.id }],
    ["conversations.listMessages", { conversationId: conversation.conversation.id }],
    ["reactions.remove", { contentType: "post", contentId: theirs.post.id }],
    ["conversations.rename", { conversationId: conversation.conversation.id, title: "Renamed" }],
    ["auth.me", {}],
  ];
  return {
    ...w,
    admin,
    moderator,
    poster,
    other,
    third,
    node,
    theirs,
    mine,
    publish,
    pending,
    accept,
    writes,
    reads,
  };
}

const acceptances = (w: { ctx: Awaited<ReturnType<typeof accounts>>["ctx"] }, userId: number) =>
  w.ctx.sqlite
    .prepare<{ kind: string; version: number; ip: string | null; accepted_at: number }, [number]>(
      "SELECT kind, version, ip, accepted_at FROM terms_acceptances WHERE user_id = ?1 ORDER BY kind, version",
    )
    .all(userId);

describe("page versions", () => {
  test("a new page is version 1; only a deliberate new version raises it", async () => {
    const w = await world();
    expect((await w.publish("terms", { newVersion: true })).version).toBe(1);
    expect((await w.publish("terms", { body: "A typo fixed" })).version).toBe(1);
    expect((await w.publish("terms", { body: "New text", newVersion: true })).version).toBe(2);
    expect((await w.run("pages.get", GUEST, { slug: "terms" })).version).toBe(2);
    expect(
      (await w.run("pages.list", w.admin.actor)).items.find(
        (item: { slug: string }) => item.slug === "terms",
      ).version,
    ).toBe(2);
    const logged = w.ctx.sqlite
      .prepare<{ details: string }, []>(
        "SELECT details FROM moderator_log WHERE action = 'page.save' ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    expect(JSON.parse(logged.details)).toMatchObject({ version: 2, newVersion: true });
  });

  test("a page created again after a delete starts above every version a member accepted", async () => {
    const w = await world();
    await w.publish("terms");
    await w.accept(w.poster.actor);
    await w.publish("terms", { newVersion: true });
    await w.accept(w.poster.actor);
    await w.run("pages.delete", w.admin.actor, { slug: "terms" });
    expect(await w.pending(w.poster.actor)).toEqual([]);
    expect((await w.publish("terms")).version).toBe(3);
    expect(await w.pending(w.poster.actor)).toEqual([{ kind: "terms", version: 3 }]);
    // A page nobody accepted under starts at one, and an unrelated slug is not affected.
    expect((await w.publish("rules")).version).toBe(1);
    const privacy = await w.run("pages.save", w.admin.actor, {
      slug: "privacy",
      title: "Privacy",
      body: "Privacy",
    });
    expect(privacy.version).toBe(1);
  });
});

describe("sign-up", () => {
  test("records the terms and the rules published now, with the time and the address", async () => {
    const w = await world();
    await w.publish("terms");
    await w.publish("rules", { newVersion: true });
    await w.publish("rules", { newVersion: true });
    const before = w.ctx.now();
    const member = await signUp(w, "Joiner", { accept: true, ip: "::ffff:203.0.113.9" });
    expect(acceptances(w, member.id)).toEqual([
      { kind: "rules", version: 2, ip: "203.0.113.9", accepted_at: expect.any(Number) },
      { kind: "terms", version: 1, ip: "203.0.113.9", accepted_at: expect.any(Number) },
    ]);
    expect(acceptances(w, member.id)[0]!.accepted_at).toBeGreaterThanOrEqual(before);
    expect(await w.pending(member.actor)).toEqual([]);
    await w.run("threads.create", member.actor, { nodeId: w.node.id, title: "Hi", body: "Hello" });
  });

  test("a sign-up that does not tick the box records nothing and is asked on the first visit", async () => {
    const w = await world();
    await w.publish("terms");
    await w.publish("rules");
    for (const accept of [undefined, false]) {
      const member = await signUp(w, `Plain${accept}`, { accept });
      expect(acceptances(w, member.id)).toEqual([]);
      expect(await w.pending(member.actor)).toEqual([
        { kind: "terms", version: 1 },
        { kind: "rules", version: 1 },
      ]);
    }
  });

  test("a page that is not published, or does not exist, is not recorded or asked", async () => {
    const w = await world();
    await w.publish("terms", { isPublished: false });
    const member = await signUp(w, "Early", { accept: true });
    expect(acceptances(w, member.id)).toEqual([]);
    expect(await w.pending(member.actor)).toEqual([]);
    await w.run("threads.create", member.actor, { nodeId: w.node.id, title: "Hi", body: "Hello" });
  });
});

describe("enforcement", () => {
  test("a member who has not accepted can read but not post, react or message", async () => {
    const w = await world();
    await w.publish("terms");
    await w.publish("rules");
    expect(await w.pending(w.poster.actor)).toEqual([
      { kind: "terms", version: 1 },
      { kind: "rules", version: 1 },
    ]);
    for (const [name, input] of w.writes) {
      const error = await outcome(w.run(name, w.poster.actor, input));
      expect(isAcceptanceRefusal(error), `${name}: ${String(error)}`).toBe(true);
      expect((error as SermoError).code).toBe("forbidden");
    }
    for (const [name, input] of w.reads) await w.run(name, w.poster.actor, input);
  });

  test("accepting opens every write; each one succeeds or fails for another reason", async () => {
    const w = await world();
    await w.publish("terms");
    await w.publish("rules");
    await w.accept(w.poster.actor);
    expect(await w.pending(w.poster.actor)).toEqual([]);
    for (const [name, input] of w.writes) {
      const error = await outcome(w.run(name, w.poster.actor, input));
      expect(error, `${name}: ${String(error)}`).toBeNull();
    }
  });

  test("a new version of one page asks again for that page only", async () => {
    const w = await world();
    await w.publish("terms");
    await w.publish("rules");
    await w.accept(w.poster.actor);
    await w.publish("rules", { body: "A typo fixed" });
    expect(await w.pending(w.poster.actor)).toEqual([]);
    await w.run("posts.create", w.poster.actor, { threadId: w.theirs.thread.id, body: "Still ok" });

    await w.publish("rules", { body: "New rules", newVersion: true });
    expect(await w.pending(w.poster.actor)).toEqual([{ kind: "rules", version: 2 }]);
    expect(
      isAcceptanceRefusal(
        await outcome(
          w.run("posts.create", w.poster.actor, { threadId: w.theirs.thread.id, body: "No" }),
        ),
      ),
    ).toBe(true);
    for (const [name, input] of w.reads) await w.run(name, w.poster.actor, input);

    await w.accept(w.poster.actor);
    await w.run("posts.create", w.poster.actor, { threadId: w.theirs.thread.id, body: "Yes" });
    expect(acceptances(w, w.poster.id).map((row) => `${row.kind}${row.version}`)).toEqual([
      "rules1",
      "rules2",
      "terms1",
    ]);
  });

  test("unpublishing a page stops asking for it; publishing it again asks only if it moved on", async () => {
    const w = await world();
    await w.publish("terms");
    await w.accept(w.poster.actor);
    await w.publish("terms", { isPublished: false });
    await w.run("posts.create", w.poster.actor, { threadId: w.theirs.thread.id, body: "Ok" });
    await w.publish("terms", { isPublished: true });
    expect(await w.pending(w.poster.actor)).toEqual([]);
  });

  test("guests are not asked; the account check still refuses them", async () => {
    const w = await world();
    await w.publish("terms");
    const error = await outcome(
      w.run("posts.create", GUEST, { threadId: w.theirs.thread.id, body: "x" }),
    );
    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((await w.run("auth.me", GUEST)).user).toBeNull();
  });

  test("an API key acts as its member and is refused the same writes", async () => {
    const w = await world();
    await w.publish("terms");
    const key = tokenActor({ id: w.poster.id, groupId: 2 });
    for (const [name, input] of w.writes)
      expect(isAcceptanceRefusal(await outcome(w.run(name, key, input))), name).toBe(true);
    await w.accept(w.poster.actor);
    await w.run("posts.create", key, { threadId: w.theirs.thread.id, body: "Now fine" });
  });

  test("a key resolved from the request carries the versions, is refused the writes and cannot accept", async () => {
    const w = await world();
    await w.publish("terms");
    const member = await signUp(w, "Keyed", { accept: false });
    const key = await createKeyFromSession(getAuth(w.ctx), member.cookie, "script", PASSWORD);
    const { actor } = await resolveActor(
      w.ctx,
      new Headers({ authorization: `Bearer ${key.key}` }),
    );
    expect(actor).toMatchObject({ kind: "token", acceptance: { terms: 0, rules: 0 } });
    expect(
      isAcceptanceRefusal(
        await outcome(w.run("posts.create", actor, { threadId: w.theirs.thread.id, body: "x" })),
      ),
    ).toBe(true);
    // Accepting is for the member in a browser session, not for a script holding their key.
    const refused = await outcome(
      w.run("terms.accept", actor, { accept: [{ kind: "terms", version: 1 }] }),
    );
    expect(refused).toBeInstanceOf(ForbiddenError);
    expect(isAcceptanceRefusal(refused)).toBe(false);
    expect(acceptances(w, member.id)).toEqual([]);
    await w.accept(member.actor);
    const accepted = (
      await resolveActor(w.ctx, new Headers({ authorization: `Bearer ${key.key}` }))
    ).actor;
    expect(accepted).toMatchObject({ acceptance: { terms: 1, rules: 0 } });
    await w.run("posts.create", accepted, { threadId: w.theirs.thread.id, body: "Now fine" });
  });

  test("the resolved actor carries the accepted versions, so the check reads nothing more", async () => {
    const w = await world();
    await w.publish("terms");
    const member = await signUp(w, "Cookie", { accept: false });
    const resolved = async () =>
      (await resolveActor(w.ctx, new Headers({ cookie: member.cookie }))).actor;
    const before = await resolved();
    expect(before).toMatchObject({ acceptance: { terms: 0, rules: 0 } });
    expect(
      isAcceptanceRefusal(
        await outcome(w.run("posts.create", before, { threadId: w.theirs.thread.id, body: "x" })),
      ),
    ).toBe(true);
    await w.accept(member.actor);
    const after = await resolved();
    expect(after).toMatchObject({ acceptance: { terms: 1, rules: 0 } });
    await w.run("posts.create", after, { threadId: w.theirs.thread.id, body: "Allowed" });
    // The versions on the actor decide: a stale actor is refused whatever the table says now.
    expect(
      isAcceptanceRefusal(
        await outcome(
          w.run(
            "posts.create",
            { ...after, acceptance: { terms: 0, rules: 0 } },
            {
              threadId: w.theirs.thread.id,
              body: "x",
            },
          ),
        ),
      ),
    ).toBe(true);
  });
});

describe("terms.accept", () => {
  test("repeats change nothing; a version that moved on or a page not published is a conflict", async () => {
    const w = await world();
    await w.publish("terms");
    await w.accept(w.poster.actor);
    await w.run("terms.accept", w.poster.actor, { accept: [{ kind: "terms", version: 1 }] });
    expect(acceptances(w, w.poster.id)).toHaveLength(1);

    await w.publish("terms", { newVersion: true });
    await expect(
      w.run("terms.accept", w.poster.actor, { accept: [{ kind: "terms", version: 1 }] }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      w.run("terms.accept", w.poster.actor, { accept: [{ kind: "rules", version: 1 }] }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(acceptances(w, w.poster.id)).toHaveLength(1);
    await w.run("terms.accept", w.poster.actor, { accept: [{ kind: "terms", version: 2 }] });
    expect(acceptances(w, w.poster.id)).toHaveLength(2);
  });

  test("keeps the address of the request", async () => {
    const w = await world();
    await w.publish("terms");
    await w.run(
      "terms.accept",
      { ...w.poster.actor, clientIp: "2001:db8::7" },
      { accept: [{ kind: "terms", version: 1 }] },
    );
    expect(acceptances(w, w.poster.id)[0]).toMatchObject({ ip: "2001:db8::7" });
    await w.run(
      "terms.accept",
      { ...w.other.actor, clientIp: "unknown" },
      { accept: [{ kind: "terms", version: 1 }] },
    );
    expect(acceptances(w, w.other.id)[0]).toMatchObject({ ip: null });
  });

  test("needs an account", async () => {
    const w = await world();
    await w.publish("terms");
    await expect(
      w.run("terms.accept", GUEST, { accept: [{ kind: "terms", version: 1 }] }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("staff view", () => {
  test("administrators read a member's versions and dates; others are refused", async () => {
    const w = await world();
    await w.publish("terms");
    await w.publish("rules");
    await w.accept(w.poster.actor);
    await w.publish("rules", { newVersion: true });
    const view = await w.run("users.adminAcceptances", w.admin.actor, { userId: w.poster.id });
    expect(view.current).toEqual({ terms: 1, rules: 2 });
    expect(
      view.items
        .map((item: { kind: string; version: number }) => `${item.kind}${item.version}`)
        .sort(),
    ).toEqual(["rules1", "terms1"]);
    expect(view.items[0]).toMatchObject({ ip: null });
    expect(new Date(view.items[0].acceptedAt).getTime()).not.toBeNaN();
    for (const actor of [w.moderator.actor, w.poster.actor, w.other.actor])
      await expect(
        w.run("users.adminAcceptances", actor, { userId: w.poster.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.run("users.adminAcceptances", GUEST, { userId: w.poster.id }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("staff view of addresses", () => {
  test("the address needs member.viewIps as well as admin.members", async () => {
    const w = await world();
    await w.publish("terms");
    await w.run(
      "terms.accept",
      { ...w.poster.actor, clientIp: "203.0.113.9" },
      { accept: [{ kind: "terms", version: 1 }] },
    );
    const group = w.ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Member managers', 20) RETURNING id",
      )
      .get()!.id;
    const definition = w.ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
      .get("admin.members")!.id;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, 0, 1)",
      )
      .run(definition, group);
    invalidate(w.ctx, "permissions");
    const manager = insertUser(w.ctx, { groupId: group });
    const seen = await w.run("users.adminAcceptances", userActor(manager), { userId: w.poster.id });
    expect(seen.items).toHaveLength(1);
    expect(seen.items[0].ip).toBeNull();
    const full = await w.run("users.adminAcceptances", w.admin.actor, { userId: w.poster.id });
    expect(full.items[0].ip).toBe("203.0.113.9");
  });
});

describe("auth.me", () => {
  test("lists what is pending and nothing once everything is accepted", async () => {
    const w = await world();
    expect(await w.pending(w.poster.actor)).toEqual([]);
    await w.publish("terms");
    expect(await w.pending(w.poster.actor)).toEqual([{ kind: "terms", version: 1 }]);
    await w.accept(w.poster.actor);
    expect(await w.pending(w.poster.actor)).toEqual([]);
  });
});

describe("erasure", () => {
  test("erasing a member removes their acceptance rows and no one else's", async () => {
    const w = await world();
    await w.publish("terms");
    await w.publish("rules");
    await w.accept(w.poster.actor);
    await w.accept(w.other.actor);
    expect(acceptances(w, w.poster.id)).toHaveLength(2);
    await w.run("users.adminErase", w.admin.actor, {
      userId: w.poster.id,
      actorPassword: PASSWORD,
      reason: "Right to be forgotten",
    });
    expect(acceptances(w, w.poster.id)).toEqual([]);
    expect(acceptances(w, w.other.id)).toHaveLength(2);
  });

  test("deleting the member row removes them too (foreign key)", async () => {
    const w = await world();
    await w.publish("terms");
    await w.accept(w.third.actor);
    w.ctx.sqlite.prepare("PRAGMA foreign_keys = ON").run();
    w.ctx.sqlite.prepare("DELETE FROM users WHERE id = ?1").run(w.third.id);
    expect(acceptances(w, w.third.id)).toEqual([]);
  });
});

describe("queries", () => {
  test("every lookup uses an index", async () => {
    const w = await world();
    expectNoTableScan(w.ctx, acceptanceSql.published, []);
    expectNoTableScan(w.ctx, acceptanceSql.newest, [w.poster.id]);
    expectNoTableScan(w.ctx, acceptanceSql.member, [w.poster.id]);
    expectNoTableScan(w.ctx, `SELECT ${acceptanceSql.newestColumns} FROM users u WHERE u.id = ?1`, [
      w.poster.id,
    ]);
  });
});
