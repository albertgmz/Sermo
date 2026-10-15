import { afterEach, describe, expect, test } from "bun:test";
import { insertNode, tokenActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import { ForbiddenError, RateLimitedError, ValidationError } from "../../errors";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";

afterEach(closeAll);

const WRONG = "wrong-wrong-1";

async function world() {
  const w = await accounts();
  const founder = await w.register("Founder", 4);
  const target = await w.register("Target");
  const node = insertNode(w.ctx, { type: "forum" }).id;
  const group = await w.run("groups.create", founder.actor, { title: "Helpers" });
  const promotion = await w.run("promotions.create", founder.actor, {
    title: "Rule",
    criteria: [{ criterion: "post_count", value: 1000 }],
    groupIds: [group.id],
  });
  const rows = (sql: string) => w.ctx.sqlite.prepare<{ n: number }, []>(sql).get()!.n;
  return {
    ...w,
    founder,
    target,
    node,
    group,
    promotion,
    groupCount: () => rows("SELECT count(*) AS n FROM groups"),
    entryCount: () => rows("SELECT count(*) AS n FROM permission_entries"),
    logCount: () => rows("SELECT count(*) AS n FROM moderator_log"),
  };
}
type World = Awaited<ReturnType<typeof world>>;

/** The founder as a browser session: what the HTTP layer resolves from a session cookie. */
const interactive = (w: World): Actor => ({ ...w.founder.actor, interactive: true }) as Actor;

/**
 * Each guarded write, as a function of the actor, and the password sent (undefined for none).
 */
const writes: [string, (w: World, actorPassword?: string, as?: Actor) => Promise<unknown>][] = [
  [
    "groups.create",
    (w, actorPassword, as = w.founder.actor) =>
      w.run("groups.create", as, { title: "New", actorPassword }),
  ],
  [
    "groups.update",
    (w, actorPassword, as = w.founder.actor) =>
      w.run("groups.update", as, {
        groupId: w.group.id,
        title: "Renamed",
        actorPassword,
      }),
  ],
  [
    "groups.delete",
    (w, actorPassword, as = w.founder.actor) =>
      w.run("groups.delete", as, { groupId: w.group.id, actorPassword }),
  ],
  [
    "users.setGroups",
    (w, actorPassword, as = w.founder.actor) =>
      w.run("users.setGroups", as, {
        userId: w.target.id,
        secondaryGroupIds: [w.group.id],
        actorPassword,
      }),
  ],
  [
    "permissions.set",
    (w, actorPassword, as = w.founder.actor) =>
      w.run("permissions.set", as, {
        groupId: w.group.id,
        entries: [{ permission: "forum.reply", value: "allow" }],
        actorPassword,
      }),
  ],
  [
    "nodes.setModerator",
    (w, actorPassword, as = w.founder.actor) =>
      w.run("nodes.setModerator", as, {
        nodeId: w.node,
        userId: w.target.id,
        actorPassword,
      }),
  ],
  [
    "promotions.create",
    (w, actorPassword, as = w.founder.actor) =>
      w.run("promotions.create", as, {
        title: "Another",
        criteria: [{ criterion: "post_count", value: 5 }],
        groupIds: [w.group.id],
        actorPassword,
      }),
  ],
  [
    "promotions.update",
    (w, actorPassword, as = w.founder.actor) =>
      w.run("promotions.update", as, {
        promotionId: w.promotion.id,
        title: "Renamed rule",
        actorPassword,
      }),
  ],
  [
    "promotions.delete",
    (w, actorPassword, as = w.founder.actor) =>
      w.run("promotions.delete", as, { promotionId: w.promotion.id, actorPassword }),
  ],
  [
    "promotions.apply",
    (w, actorPassword, as = w.founder.actor) =>
      w.run("promotions.apply", as, {
        userId: w.target.id,
        promotionId: w.promotion.id,
        action: "promote",
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
    w.ctx.sqlite.prepare("SELECT id, title, group_ids FROM promotions ORDER BY id").all(),
    w.ctx.sqlite.prepare("SELECT user_id, state FROM user_promotions").all(),
  ]);

describe("the actorPassword on group, permission and promotion writes", () => {
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

      test("an in-process actor (built by hand) is not asked for a password", async () => {
        const w = await world();
        const before = snapshot(w);
        await write(w);
        expect(snapshot(w)).not.toBe(before);
      });

      test("an API key is refused without a password, and changes nothing", async () => {
        const w = await world();
        const before = snapshot(w);
        await expect(write(w, undefined, tokenActor(w.founder))).rejects.toBeInstanceOf(
          ForbiddenError,
        );
        expect(snapshot(w)).toBe(before);
      });

      test("an API key is refused with the right or a wrong password, and changes nothing", async () => {
        const w = await world();
        const before = snapshot(w);
        for (const password of [PASSWORD, WRONG])
          await expect(write(w, password, tokenActor(w.founder))).rejects.toThrow(
            /signed-in session; an API key cannot do it/,
          );
        expect(snapshot(w)).toBe(before);
      });

      test("an interactive session must send one, and changes nothing without", async () => {
        const w = await world();
        const before = snapshot(w);
        const refused = await write(w, undefined, interactive(w)).catch((error) => error);
        expect(refused).toBeInstanceOf(ValidationError);
        expect((refused as ValidationError).issues).toEqual([
          { path: ["actorPassword"], message: "Required" },
        ]);
        expect(snapshot(w)).toBe(before);
        await write(w, PASSWORD, interactive(w));
        expect(snapshot(w)).not.toBe(before);
      });

      test("an interactive session with a wrong password changes nothing", async () => {
        const w = await world();
        const before = snapshot(w);
        await expect(write(w, WRONG, interactive(w))).rejects.toThrow(/not your password/);
        expect(snapshot(w)).toBe(before);
      });
    });
  }

  test("an API key does not count against the password limit", async () => {
    const w = await world();
    const key = tokenActor(w.founder);
    for (let i = 0; i < 6; i++)
      await expect(writes[0]![1](w, WRONG, key)).rejects.toBeInstanceOf(ForbiddenError);
    await writes[0]![1](w, PASSWORD);
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
