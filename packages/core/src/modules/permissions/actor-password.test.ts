import { afterEach, describe, expect, test } from "bun:test";
import { insertNode, tokenActor } from "@sermo/core/testing";
import { ForbiddenError, RateLimitedError } from "../../errors";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";

afterEach(closeAll);

const WRONG = "wrong-wrong-1";

async function world() {
  const w = await accounts();
  const founder = await w.register("Founder", 4);
  const target = await w.register("Target");
  const node = insertNode(w.ctx, { type: "forum" }).id;
  const group = await w.run("groups.create", founder.actor, { title: "Helpers" });
  const rows = (sql: string) => w.ctx.sqlite.prepare<{ n: number }, []>(sql).get()!.n;
  return {
    ...w,
    founder,
    target,
    node,
    group,
    groupCount: () => rows("SELECT count(*) AS n FROM groups"),
    entryCount: () => rows("SELECT count(*) AS n FROM permission_entries"),
    logCount: () => rows("SELECT count(*) AS n FROM moderator_log"),
  };
}
type World = Awaited<ReturnType<typeof world>>;

/** Each guarded write, as a function of the password sent (undefined for none). */
const writes: [string, (w: World, actorPassword?: string) => Promise<unknown>][] = [
  [
    "groups.create",
    (w, actorPassword) => w.run("groups.create", w.founder.actor, { title: "New", actorPassword }),
  ],
  [
    "groups.update",
    (w, actorPassword) =>
      w.run("groups.update", w.founder.actor, {
        groupId: w.group.id,
        title: "Renamed",
        actorPassword,
      }),
  ],
  [
    "groups.delete",
    (w, actorPassword) =>
      w.run("groups.delete", w.founder.actor, { groupId: w.group.id, actorPassword }),
  ],
  [
    "users.setGroups",
    (w, actorPassword) =>
      w.run("users.setGroups", w.founder.actor, {
        userId: w.target.id,
        secondaryGroupIds: [w.group.id],
        actorPassword,
      }),
  ],
  [
    "permissions.set",
    (w, actorPassword) =>
      w.run("permissions.set", w.founder.actor, {
        groupId: w.group.id,
        entries: [{ permission: "forum.reply", value: "allow" }],
        actorPassword,
      }),
  ],
  [
    "nodes.setModerator",
    (w, actorPassword) =>
      w.run("nodes.setModerator", w.founder.actor, {
        nodeId: w.node,
        userId: w.target.id,
        actorPassword,
      }),
  ],
];

/** What a write changes, as one comparable snapshot. */
const snapshot = (w: World) =>
  JSON.stringify([
    w.groupCount(),
    w.entryCount(),
    w.logCount(),
    w.ctx.sqlite.prepare("SELECT title FROM groups ORDER BY id").all(),
    w.ctx.sqlite.prepare("SELECT user_id, group_id FROM user_groups").all(),
  ]);

describe("the optional actorPassword on group and permission writes", () => {
  for (const [name, write] of writes) {
    describe(name, () => {
      test("a wrong password changes nothing", async () => {
        const w = await world();
        const before = snapshot(w);
        await expect(write(w, WRONG)).rejects.toThrow(/not your password/);
        expect(snapshot(w)).toBe(before);
      });

      test("the right password lets the write through", async () => {
        const w = await world();
        const before = snapshot(w);
        await write(w, PASSWORD);
        expect(snapshot(w)).not.toBe(before);
      });

      test("without a password the write works as before", async () => {
        const w = await world();
        const before = snapshot(w);
        await write(w);
        expect(snapshot(w)).not.toBe(before);
      });
    });
  }

  test("an API key that sends the password is refused, and one that does not is not", async () => {
    const w = await world();
    const key = tokenActor(w.founder);
    await expect(
      w.run("groups.create", key, { title: "Keyed", actorPassword: PASSWORD }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.groupCount()).toBe(5 + 1);
    await w.run("groups.create", key, { title: "Keyed" });
    expect(w.groupCount()).toBe(5 + 2);
  });

  test("a member without the permission is still refused with the right password", async () => {
    const w = await world();
    await expect(
      w.run("groups.create", w.target.actor, { title: "Nope", actorPassword: PASSWORD }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.run("permissions.set", w.target.actor, {
        groupId: w.group.id,
        entries: [{ permission: "forum.reply", value: "allow" }],
        actorPassword: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("wrong answers share the limit with the other confirmations", async () => {
    const w = await world();
    for (let i = 0; i < 5; i++) await expect(writes[0]![1](w, WRONG)).rejects.toThrow(/not your/);
    await expect(writes[4]![1](w, PASSWORD)).rejects.toBeInstanceOf(RateLimitedError);
    await expect(writes[3]![1](w, PASSWORD)).rejects.toBeInstanceOf(RateLimitedError);
    // Without the password the same writes still work: the limit guards the confirmation only.
    await writes[4]![1](w);
  });
});
