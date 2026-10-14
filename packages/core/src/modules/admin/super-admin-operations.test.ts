import { afterEach, describe, expect, test } from "bun:test";
import { insertNode } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { accounts, closeAll, PASSWORD } from "./fixtures.test";

afterEach(closeAll);

const MODERATOR_PERMISSIONS = [
  "member.ban",
  "member.warn",
  "member.restrict",
  "member.spamCleanup",
  "forum.threadBan",
  "admin.members",
  "node.view",
];

async function world() {
  const w = await accounts();
  const owner = await w.register("Owner", 4);
  const plain = await w.register("Plain", 4);
  w.ctx.sqlite.prepare("UPDATE users SET is_super_admin = 1 WHERE id = ?1").run(owner.id);
  // A moderator group ranked above everyone, holding every permission the operations ask for.
  w.ctx.sqlite.prepare("INSERT INTO groups (id, title, rank) VALUES (90, 'Mods', 99999)").run();
  await w.run("permissions.set", owner.actor, {
    groupId: 90,
    entries: MODERATOR_PERMISSIONS.map((permission) => ({ permission, value: "allow" })),
  });
  const moderator = await w.register("Mod", 90);
  const node = insertNode(w.ctx, { title: "Forum", type: "forum" });
  invalidate(w.ctx, "node_tree");
  let count = 0;
  /** A new member who is a super admin, with a thread the thread-ban operation can use. */
  const victim = async () => {
    count += 1;
    const member = await w.register(`Victim${count}`, 2);
    w.ctx.sqlite.prepare("UPDATE users SET is_super_admin = 1 WHERE id = ?1").run(member.id);
    const thread = await w.run("threads.create", member.actor, {
      nodeId: node.id,
      title: `Thread ${count}`,
      body: "Body",
    });
    return { id: member.id, threadId: thread.thread.id as number };
  };
  return { ...w, owner, plain, moderator, victim };
}

type World = Awaited<ReturnType<typeof world>>;
type Victim = Awaited<ReturnType<World["victim"]>>;

const operations: [string, string, (v: Victim) => object][] = [
  ["bans.create", "ban", (v) => ({ userId: v.id, reason: "r", expiresAt: null })],
  ["warnings.create", "warn", (v) => ({ userId: v.id, points: 1, reason: "r" })],
  [
    "restrictions.create",
    "restriction",
    (v) => ({ userId: v.id, kind: "posting", reason: "r", expiresAt: null, notify: false }),
  ],
  ["spamCleanup.start", "spam cleanup", (v) => ({ userId: v.id, reason: "r" })],
  ["threadBans.create", "thread ban", (v) => ({ threadId: v.threadId, userId: v.id, reason: "r" })],
  ["users.adminErase", "erase", (v) => ({ userId: v.id, actorPassword: PASSWORD, reason: "r" })],
  ["users.adminUpdateProfile", "profile edit", (v) => ({ userId: v.id, about: "Changed" })],
  [
    "users.adminUpdateIdentity",
    "identity edit",
    (v) => ({ userId: v.id, actorPassword: PASSWORD, username: `Renamed${v.id}` }),
  ],
  ["users.adminRevokeSessions", "sessions", (v) => ({ userId: v.id })],
];

describe("a super admin as the target of a hierarchy operation", () => {
  for (const [name, label, input] of operations) {
    test(`${label}: a plain administrator and a higher-ranked moderator are refused, a super admin is not`, async () => {
      const w = await world();
      const target = await w.victim();
      for (const as of [w.plain, w.moderator])
        await expect(w.run(name, as.actor, input(target))).rejects.toBeInstanceOf(ForbiddenError);
      await w.run(name, w.owner.actor, input(target));
    });
  }

  test("a target who becomes a super admin before the write is refused", async () => {
    const w = await world();
    const member = await w.register("Becomes", 2);
    const database = sharedDatabase(w.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const stale = resolvedActor(here, w.plain.id);
      // The early check passes (the member is no super admin); the password check then yields,
      // and the flag is set from another process before the write transaction opens.
      const attempt = execute(here, getOperation("users.adminErase"), stale, {
        userId: member.id,
        actorPassword: PASSWORD,
        reason: "Stale",
      });
      elsewhere.sqlite.prepare("UPDATE users SET is_super_admin = 1 WHERE id = ?1").run(member.id);
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        here.sqlite
          .prepare<{ erased_at: number | null }, [number]>(
            "SELECT erased_at FROM users WHERE id = ?1",
          )
          .get(member.id)!.erased_at,
      ).toBeNull();
    } finally {
      database.close();
    }
  });
});
