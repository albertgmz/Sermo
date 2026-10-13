import { afterEach, describe, expect, test } from "bun:test";
import { tokenActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedPermissions } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { insertCatalogImage, insertPaletteColor } from "../appearance/catalog-fixtures";
import { accounts, closeAll } from "./fixtures.test";

afterEach(closeAll);

async function world() {
  const w = await accounts();
  const founder = await w.register("Founder", 4);
  const target = await w.register("Target");
  const edit = (input: object, as: { actor: object } = founder) =>
    w.run("users.adminUpdateProfile", as.actor, { userId: target.id, ...input });
  const stored = () =>
    w.ctx.sqlite
      .prepare<Record<string, unknown>, [number]>("SELECT * FROM users WHERE id = ?1")
      .get(target.id)!;
  return { ...w, founder, target, edit, stored };
}

describe("users.adminUpdateProfile", () => {
  test("sets and clears the birthday and the social handles like profiles.update", async () => {
    const w = await world();
    await w.edit({
      birthday: { year: 1990, month: 5, day: 17 },
      socials: { discord: "target#1", x: "target_x" },
    });
    expect(w.stored()).toMatchObject({
      birthday_md: "05-17",
      birth_year: 1990,
      social_discord: "target#1",
      social_telegram: "",
      social_x: "target_x",
    });
    await expect(w.edit({ birthday: { month: 2, day: 31 } })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await w.edit({ birthday: null, socials: { x: "" } });
    expect(w.stored()).toMatchObject({ birthday_md: null, birth_year: null, social_x: "" });
  });

  test("removing a picture the member does not have changes nothing and logs nothing", async () => {
    const w = await world();
    const view = await w.edit({ removeAvatar: true, removeCover: true });
    expect(view.card.username).toBe("Target");
    expect(w.logOf(w.target.id)).toEqual([]);
    expect(
      w.ctx.sqlite.prepare("SELECT 1 FROM domain_events WHERE type = 'content.edited'").get(),
    ).toBeNull();
  });

  test("sets the profile fields, a title and a signature included, whatever the member may show", async () => {
    const w = await world();
    const view = await w.edit({
      about: "About text",
      location: "Madrid",
      website: "https://example.org",
      customTitle: "  The   Boss ",
      signature: "My *signature*",
      reason: "Cleanup",
    });
    expect(view.card.username).toBe("Target");
    expect(w.stored()).toMatchObject({
      about: "About text",
      location: "Madrid",
      website: "https://example.org",
      custom_title: "The Boss",
      signature_source: "My *signature*",
    });
    expect(String(w.stored().signature_html)).toContain("<em>signature</em>");
    // The member does not hold the permissions to show them: stored all the same.
    expect((await w.run("profiles.self", w.target.actor)).may).toEqual({
      setSignature: false,
      setCustomTitle: false,
    });
    expect(w.logOf(w.target.id)).toEqual([
      {
        action: "member.profile",
        reason: "Cleanup",
        details: {
          fields: [
            "about",
            "location",
            "website",
            "custom_title",
            "signature_source",
            "signature_html",
          ],
          removed: [],
        },
      },
    ]);
    // Only the keys sent change; null clears.
    await w.edit({ customTitle: null, signature: null });
    expect(w.stored()).toMatchObject({
      about: "About text",
      custom_title: null,
      signature_source: null,
    });
  });

  test("the fields obey the same rules as the member's own edit", async () => {
    const w = await world();
    await expect(w.edit({ website: "javascript:alert(1)" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(w.edit({ signature: "# heading" })).rejects.toBeInstanceOf(ValidationError);
    await expect(w.edit({ customTitle: "x".repeat(100) })).rejects.toBeInstanceOf(ValidationError);
    expect(w.stored()).toMatchObject({ website: "", custom_title: null });
    expect(w.logOf(w.target.id)).toEqual([]);
  });

  test("puts on any active entry, held or not, and takes it off with null", async () => {
    const w = await world();
    const accent = insertPaletteColor(w.ctx, { kind: "accent" });
    const name = insertPaletteColor(w.ctx, { kind: "name" });
    const frame = insertCatalogImage(w.ctx, "frame");
    const cover = insertCatalogImage(w.ctx, "profile_cover");
    await w.edit({ accentId: accent, nameColorId: name, frameId: frame, coverPresetId: cover });
    expect(w.stored()).toMatchObject({
      accent_color_id: accent,
      name_color_id: name,
      frame_id: frame,
      cover_preset_id: cover,
    });
    await w.edit({ accentId: null, nameColorId: null, frameId: null, coverPresetId: null });
    expect(w.stored()).toMatchObject({ accent_color_id: null, frame_id: null });
    const inactive = insertPaletteColor(w.ctx, { kind: "accent", active: false });
    const unpictured = insertCatalogImage(w.ctx, "frame", { picture: false });
    const wrongKind = insertCatalogImage(w.ctx, "thread_cover");
    for (const input of [
      { accentId: inactive },
      { accentId: name },
      { nameColorId: accent },
      { frameId: unpictured },
      { frameId: cover },
      { coverPresetId: wrongKind },
      { accentId: 99999 },
    ])
      await expect(w.edit(input), JSON.stringify(input)).rejects.toBeInstanceOf(ValidationError);
  });

  test("removes the uploaded pictures and releases their files", async () => {
    const w = await world();
    const file = (purpose: string) =>
      w.ctx.sqlite
        .prepare<{ id: number }, [number, string, number]>(
          "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at, attached_at) VALUES ('fake', 'k' || ?3, 1, 'image/png', 'h', ?1, ?2, 'public', ?3, ?3) RETURNING id",
        )
        .get(w.target.id, purpose, w.ctx.now() + Math.floor(Math.random() * 1e6))!.id;
    const avatar = file("avatar");
    const cover = file("cover");
    w.ctx.sqlite
      .prepare("UPDATE users SET avatar_file_id = ?1, cover_file_id = ?2 WHERE id = ?3")
      .run(avatar, cover, w.target.id);
    await w.edit({ removeAvatar: true });
    expect(w.stored()).toMatchObject({ avatar_file_id: null, cover_file_id: cover });
    await w.edit({ removeCover: true, removeAvatar: true });
    expect(w.stored()).toMatchObject({ avatar_file_id: null, cover_file_id: null });
    const released = w.ctx.sqlite
      .prepare<{ unique_key: string }, []>(
        "SELECT unique_key FROM jobs WHERE type = 'storage.deletePermanent' ORDER BY id",
      )
      .all()
      .map((job) => job.unique_key);
    expect(released).toEqual([
      `storage.deletePermanent.${avatar}`,
      `storage.deletePermanent.${cover}`,
    ]);
    expect(w.logOf(w.target.id).map((entry) => entry.details.removed)).toEqual([
      ["avatar"],
      ["cover"],
    ]);
  });

  test("an empty edit changes and logs nothing", async () => {
    const w = await world();
    await w.edit({});
    expect(w.logOf(w.target.id)).toEqual([]);
  });

  test("who may: administrators over the member only", async () => {
    const w = await world();
    const member = await w.register("Plain");
    const moderator = await w.register("Moderator", 3);
    const peer = await w.register("Peer", 4);
    await expect(w.edit({ about: "x" }, { actor: GUEST })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    for (const who of [member, moderator])
      await expect(w.edit({ about: "x" }, who)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.run("users.adminUpdateProfile", peer.actor, { userId: w.founder.id, about: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.edit({ about: "x" }, { actor: tokenActor(w.founder) })).resolves.toBeDefined();
    await expect(
      w.run("users.adminUpdateProfile", w.founder.actor, { userId: 9999, about: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("an administrator revoked in another process changes nothing", async () => {
    const w = await world();
    const delegate = await w.register("Delegate");
    await w.run("permissions.set", w.founder.actor, {
      userId: delegate.id,
      entries: [{ permission: "admin.members", value: "allow" }],
    });
    const lower = await w.register("Lowly");
    void lower;
    const database = sharedDatabase(w.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      // The delegate outranks nobody but is a moderator-ranked member here.
      here.sqlite.prepare("UPDATE users SET group_id = 3 WHERE id = ?1").run(delegate.id);
      const stale = resolvedActor(here, delegate.id);
      resolvedPermissions(here, stale);
      await execute(
        elsewhere,
        getOperation("permissions.set"),
        resolvedActor(elsewhere, w.founder.id),
        {
          userId: delegate.id,
          entries: [{ permission: "admin.members", value: "unset" }],
        },
      );
      await expect(
        execute(here, getOperation("users.adminUpdateProfile"), stale, {
          userId: w.target.id,
          about: "Hijacked",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        here.sqlite
          .prepare<{ about: string }, [number]>("SELECT about FROM users WHERE id = ?1")
          .get(w.target.id)!.about,
      ).toBe("");
    } finally {
      database.close();
    }
  });
});

describe("users.adminSessions, users.adminRevokeSessions and users.adminLog", () => {
  test("lists the sessions without a token and revokes one or all, logging each", async () => {
    const w = await world();
    for (let i = 0; i < 3; i++) await w.signIn("target@example.test");
    const listed = await w.run("users.adminSessions", w.founder.actor, { userId: w.target.id });
    expect(listed.items).toHaveLength(4);
    expect(JSON.stringify(listed)).not.toMatch(/token/i);
    const ids = listed.items.map((item: { id: number }) => item.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(
      await w.run("users.adminRevokeSessions", w.founder.actor, {
        userId: w.target.id,
        sessionId: ids[0],
        reason: "Lost phone",
      }),
    ).toEqual({ revoked: 1 });
    expect(w.sessions(w.target.id)).toBe(3);
    // A session of someone else is not found.
    const other = await w.register("Other");
    const foreign = (await w.run("users.adminSessions", w.founder.actor, { userId: other.id }))
      .items[0].id;
    await expect(
      w.run("users.adminRevokeSessions", w.founder.actor, {
        userId: w.target.id,
        sessionId: foreign,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await w.run("users.adminRevokeSessions", w.founder.actor, { userId: w.target.id }),
    ).toEqual({ revoked: 3 });
    expect(w.sessions(w.target.id)).toBe(0);
    expect(w.sessions(other.id)).toBe(1);
    expect(
      w.logOf(w.target.id).map((entry) => [entry.action, entry.reason, entry.details.revoked]),
    ).toEqual([
      ["member.sessions.revoke", "Lost phone", 1],
      ["member.sessions.revoke", "", 3],
    ]);
  });

  test("hierarchy and permissions", async () => {
    const w = await world();
    const peer = await w.register("Peer", 4);
    const member = await w.register("Plain");
    const moderator = await w.register("Moderator", 3);
    for (const name of ["users.adminSessions", "users.adminRevokeSessions"]) {
      await expect(w.run(name, peer.actor, { userId: w.founder.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(w.run(name, moderator.actor, { userId: w.target.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(w.run(name, member.actor, { userId: w.target.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(w.run(name, GUEST, { userId: w.target.id })).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    }
  });

  test("a revoked administrator signs nobody out", async () => {
    const w = await world();
    const delegate = await w.register("Delegate", 3);
    await w.run("permissions.set", w.founder.actor, {
      userId: delegate.id,
      entries: [{ permission: "admin.members", value: "allow" }],
    });
    const database = sharedDatabase(w.ctx);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const stale = resolvedActor(here, delegate.id);
      resolvedPermissions(here, stale);
      await execute(
        elsewhere,
        getOperation("permissions.set"),
        resolvedActor(elsewhere, w.founder.id),
        {
          userId: delegate.id,
          entries: [{ permission: "admin.members", value: "unset" }],
        },
      );
      await expect(
        execute(here, getOperation("users.adminRevokeSessions"), stale, { userId: w.target.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        here.sqlite
          .prepare<{ n: number }, [number]>(
            "SELECT count(*) AS n FROM auth_session WHERE user_id = ?1",
          )
          .get(w.target.id)!.n,
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  test("the log shows every write about the member, newest first, with actors", async () => {
    const w = await world();
    const moderator = await w.register("Moderator", 3);
    await w.run("warnings.create", moderator.actor, {
      userId: w.target.id,
      points: 1,
      reason: "Rude",
      notify: false,
    });
    await w.run("restrictions.create", moderator.actor, {
      userId: w.target.id,
      kind: "posting",
      reason: "Cool off",
      expiresAt: null,
      notify: false,
    });
    const ban = await w.run("bans.create", w.founder.actor, {
      userId: w.target.id,
      reason: "Spam",
      expiresAt: null,
      notify: false,
    });
    await w.run("bans.lift", w.founder.actor, { banId: ban.id, reason: "Mistake", notify: false });
    await w.run("users.setGroups", w.founder.actor, {
      userId: w.target.id,
      secondaryGroupIds: [3],
    });
    await w.run("users.adminUpdateProfile", w.founder.actor, { userId: w.target.id, about: "x" });
    const first = await w.run("users.adminLog", w.founder.actor, { userId: w.target.id, limit: 4 });
    expect(first.items.map((entry: { action: string }) => entry.action)).toEqual([
      "member.profile",
      "user.groups",
      "ban.lift",
      "ban.add",
    ]);
    expect(first.items[0].actor).toMatchObject({ username: "Founder" });
    const second = await w.run("users.adminLog", w.founder.actor, {
      userId: w.target.id,
      cursor: first.nextCursor,
    });
    expect(second.items.map((entry: { action: string }) => entry.action)).toEqual([
      "restriction.add",
      "warning.add",
    ]);
    expect(second.nextCursor).toBeNull();
    // Entries about another member are not here.
    expect(
      (await w.run("users.adminLog", w.founder.actor, { userId: w.founder.id })).items,
    ).toEqual([]);
  });

  test("the log is for administrators of members", async () => {
    const w = await world();
    const moderator = await w.register("Moderator", 3);
    await expect(
      w.run("users.adminLog", moderator.actor, { userId: w.target.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.run("users.adminLog", GUEST, { userId: w.target.id })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await w.run("users.adminLog", tokenActor(w.founder), { userId: w.target.id });
  });
});
