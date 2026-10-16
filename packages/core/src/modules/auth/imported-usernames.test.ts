import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import { ConflictError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { renderContent } from "../../render";
import { getAuth } from "./index";
import { renameThroughAuth } from "./username";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const PASSWORD = "Password123!";
// Shapes the XenForo dump holds that the registration rule refuses: quotes, a leading symbol, an
// "@" with no dot after it, two letters, a trailing symbol.
const FAILING = ['"Yoandy_Isse"', "#Bishop", "$kyw@lker", "ab", "!-⚓ El ITALIANO ⚓", "Zoe!"];

function world() {
  const ctx = createTestContext();
  contexts.push(ctx);
  // The importer writes these rows itself (identity, password account, imported flag).
  const importAccount = async (username: string, groupId = 2) => {
    const user = insertUser(ctx, { username, groupId });
    const hash = await Bun.password.hash(PASSWORD, ctx.config.passwordHash);
    ctx.sqlite
      .prepare(
        "INSERT INTO auth_account (account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?1, 'credential', ?2, ?3, ?4, ?4)",
      )
      .run(String(user.id), user.id, hash, ctx.now());
    ctx.sqlite.prepare("UPDATE users SET imported = 1 WHERE id = ?1").run(user.id);
    return user;
  };
  // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
  const run = (name: string, actor: object, input: object = {}): Promise<any> =>
    execute(ctx, getOperation(name), actor as never, input);
  const stored = (id: number) =>
    ctx.sqlite
      .prepare<{ username: string; username_key: string; imported: number }, [number]>(
        "SELECT username, username_key, imported FROM users WHERE id = ?1",
      )
      .get(id);
  return { ctx, importAccount, run, stored };
}

describe("imported accounts keep the username they came with", () => {
  test("they sign in by username, in any letter case", async () => {
    const w = world();
    for (const name of FAILING) {
      const user = await w.importAccount(name);
      for (const typed of [name, name.toUpperCase(), name.toLowerCase()]) {
        const signedIn = await getAuth(w.ctx).api.signInUsername({
          body: { username: typed, password: PASSWORD },
        });
        expect(signedIn?.user.id).toBe(String(user.id));
      }
    }
  });

  test("a wrong password and an unknown name are still refused alike", async () => {
    const w = world();
    await w.importAccount("ab");
    for (const body of [
      { username: "ab", password: "wrong-password" },
      { username: "no", password: PASSWORD },
    ])
      await expect(getAuth(w.ctx).api.signInUsername({ body })).rejects.toMatchObject({
        statusCode: 401,
        body: { code: "INVALID_USERNAME_OR_PASSWORD" },
      });
  });

  test("they are displayed, found by search and mentioned", async () => {
    const w = world();
    const reader = userActor(insertUser(w.ctx));
    const bishop = await w.importAccount("#Bishop");
    const short = await w.importAccount("ab");
    const quoted = await w.importAccount('"Yoandy_Isse"');
    const [card] = (await w.run("users.cards", GUEST, { userIds: [bishop.id] })).items;
    expect(card.username).toBe("#Bishop");
    expect((await w.run("users.search", reader, { prefix: "#bis" })).items).toEqual([
      { id: bishop.id, username: "#Bishop" },
    ]);
    const rendered = renderContent(
      w.ctx,
      reader,
      `[USER=${bishop.id}]#Bishop[/USER] [USER=${short.id}]ab[/USER] [USER=${quoted.id}]"Yoandy_Isse"[/USER]`,
    );
    expect(rendered.mentionedUserIds.sort()).toEqual([bishop.id, short.id, quoted.id].sort());
    expect(rendered.html).toContain(">@#Bishop</a>");
    expect(rendered.html).toContain(">@ab</a>");
  });
});

describe("new names keep the registration rule", () => {
  test("a registration with a name the rule refuses is refused, however the importer treats it", async () => {
    const w = world();
    await w.importAccount("ab");
    await w.importAccount('"Yoandy_Isse"');
    for (const [username, code] of [
      ["ab", "USERNAME_TOO_SHORT"],
      ['"Yoandy_Isse"', "INVALID_USERNAME"],
      ["#Bishop", "INVALID_USERNAME"],
      ["$kyw@lker", "INVALID_USERNAME"],
      ["a".repeat(33), "USERNAME_TOO_LONG"],
    ] as const)
      await expect(
        getAuth(w.ctx).api.signUpEmail({
          body: {
            name: username,
            username,
            email: `${username.length}-${code}@example.test`,
            password: "password123",
          },
        }),
      ).rejects.toMatchObject({ statusCode: 400, body: { code } });
    await expect(
      getAuth(w.ctx).api.isUsernameAvailable({ body: { username: "#Bishop" } }),
    ).rejects.toMatchObject({ statusCode: 422, body: { code: "INVALID_USERNAME" } });
  });

  test("a display name alone cannot register a name the rule refuses", async () => {
    const w = world();
    await expect(
      getAuth(w.ctx).api.signUpEmail({
        body: {
          name: "ab",
          displayUsername: "ab",
          email: "display@example.test",
          password: "password123",
        } as never,
      }),
    ).rejects.toMatchObject({ body: { code: "INVALID_DISPLAY_USERNAME" } });
    expect(w.ctx.sqlite.prepare("SELECT id FROM auth_user").all()).toEqual([]);
  });

  test("the Deleted member names stay reserved for new names", async () => {
    const w = world();
    await expect(
      getAuth(w.ctx).api.signUpEmail({
        body: {
          name: "Deleted member 9",
          username: "Deleted member 9",
          email: "reserved@example.test",
          password: "password123",
        },
      }),
    ).rejects.toMatchObject({ body: { code: "USERNAME_IS_ALREADY_TAKEN" } });
  });

  test("an imported account may rename to a valid name, never to an invalid one or a reserved one", async () => {
    const w = world();
    // A moderator renames free of charge, so the test needs no shop.
    const user = await w.importAccount('"Yoandy_Isse"', 3);
    const actor = userActor(user);
    const rename = (username: string) => w.run("users.changeUsername", actor, { username });
    await expect(rename("ab")).rejects.toBeInstanceOf(ValidationError);
    await expect(rename("#Other")).rejects.toBeInstanceOf(ValidationError);
    await expect(rename("x".repeat(33))).rejects.toBeInstanceOf(ValidationError);
    await expect(rename("Deleted member 77")).rejects.toBeInstanceOf(ConflictError);
    expect(w.stored(user.id)?.username).toBe('"Yoandy_Isse"');
    expect(await rename("Yoandy Isse")).toMatchObject({ username: "Yoandy Isse" });
    expect(w.stored(user.id)).toEqual({
      username: "Yoandy Isse",
      username_key: "yoandy isse",
      imported: 1,
    });
    // The renamed account now follows the rule like everyone else.
    await expect(rename("#Back")).rejects.toBeInstanceOf(ValidationError);
  });

  test("a rename undone puts an imported account's own name back, and only an imported account's", async () => {
    const w = world();
    const imported = await w.importAccount("#Bishop", 3);
    const native = insertUser(w.ctx, { username: "Native", groupId: 3 });
    for (const user of [imported, native])
      await renameThroughAuth(w.ctx, user.id, `Other ${user.id}`, user.username.toLowerCase());
    await renameThroughAuth(w.ctx, imported.id, "#Bishop", `other ${imported.id}`, {
      reserved: true,
    });
    expect(w.stored(imported.id)?.username).toBe("#Bishop");
    // The same undoing is refused for an account that never held an invalid name.
    await expect(
      renameThroughAuth(w.ctx, native.id, "#Native", `other ${native.id}`, { reserved: true }),
    ).rejects.toBeDefined();
    expect(w.stored(native.id)?.username).toBe(`Other ${native.id}`);
  });

  test("nothing in the forum's own operations sets the flag", async () => {
    const w = world();
    const signedUp = await getAuth(w.ctx).api.signUpEmail({
      body: {
        name: "Fresh",
        username: "Fresh",
        email: "fresh@example.test",
        password: "password123",
      },
    });
    expect(w.stored(Number(signedUp.user.id))?.imported).toBe(0);
  });
});
