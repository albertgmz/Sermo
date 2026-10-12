import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { ValidationError } from "../../errors";
import { countStatements } from "../feed/fixtures.test";
import { bulk, type World, world } from "./fixtures.test";

type Author = {
  card: { id: number; level: number };
  cover: { fileId: number; url: string } | null;
  createdAt: string;
  postCount: number;
  reactionScore: number;
  awardXp: number;
  currentLevelXp: number;
  nextLevelXp: number;
  awards: { id: number; name: string; icon: string; tier: string; image: unknown }[];
  signatureHtml: string | null;
};
const authors = async (w: World, ids: number[], actor: object = w.memberActor) =>
  (await w.call("users.authors", actor, { userIds: ids })).items as Author[];
const one = async (w: World, id: number) => (await authors(w, [id]))[0]!;
/** The gallery covers show only for members who may use the gallery. */
const allowPresets = (w: World, userId: number, value = 1) => {
  w.ctx.sqlite
    .prepare(
      "DELETE FROM permission_entries WHERE user_id = ?1 AND permission_id = (SELECT id FROM permission_definitions WHERE key = 'profile.coverPreset')",
    )
    .run(userId);
  w.ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT 0, ?1, 0, id, ?2 FROM permission_definitions WHERE key = 'profile.coverPreset'",
    )
    .run(userId, value);
};

describe("users.authors: the profile cover", () => {
  test("a gallery cover wins over an uploaded one", async () => {
    const w = world();
    allowPresets(w, w.member.id);
    const presetFile = w.file(w.admin.id, "cover_preset");
    const uploaded = w.file(w.member.id, "cover");
    w.set(w.member.id, {
      cover_preset_id: w.image("profile_cover", presetFile, { placement: false }),
      cover_file_id: uploaded,
    });
    expect((await one(w, w.member.id)).cover).toEqual({
      fileId: presetFile,
      url: `/api/v1/files/${presetFile}`,
    });
  });

  test("an inactive gallery cover still shows", async () => {
    const w = world();
    allowPresets(w, w.member.id);
    const presetFile = w.file(w.admin.id, "cover_preset");
    w.set(w.member.id, {
      cover_preset_id: w.image("profile_cover", presetFile, { placement: false, active: false }),
    });
    expect((await one(w, w.member.id)).cover?.fileId).toBe(presetFile);
  });

  test("only an uploaded cover", async () => {
    const w = world();
    const uploaded = w.file(w.member.id, "cover");
    w.set(w.member.id, { cover_file_id: uploaded });
    expect((await one(w, w.member.id)).cover).toEqual({
      fileId: uploaded,
      url: `/api/v1/files/${uploaded}`,
    });
  });

  test("a gallery entry without a picture falls back to the uploaded cover", async () => {
    const w = world();
    const uploaded = w.file(w.member.id, "cover");
    w.set(w.member.id, {
      cover_preset_id: w.image("profile_cover", null, { placement: false }),
      cover_file_id: uploaded,
    });
    expect((await one(w, w.member.id)).cover?.fileId).toBe(uploaded);
  });

  test("a member without profile.coverPreset shows the uploaded cover, or none, while the choice is kept", async () => {
    const w = world();
    const presetFile = w.file(w.admin.id, "cover_preset");
    const uploaded = w.file(w.member.id, "cover");
    const preset = w.image("profile_cover", presetFile, { placement: false });
    w.set(w.member.id, { cover_preset_id: preset, cover_file_id: uploaded });
    expect((await one(w, w.member.id)).cover?.fileId).toBe(uploaded);
    const profile = await w.call("profiles.get", w.memberActor, { userId: w.member.id });
    expect(profile.cover.fileId).toBe(uploaded);
    w.set(w.member.id, { cover_file_id: null });
    expect((await one(w, w.member.id)).cover).toBeNull();
    allowPresets(w, w.member.id);
    expect((await one(w, w.member.id)).cover?.fileId).toBe(presetFile);
    allowPresets(w, w.member.id, -1);
    expect((await one(w, w.member.id)).cover).toBeNull();
    expect(
      w.ctx.sqlite.prepare("SELECT cover_preset_id FROM users WHERE id = ?1").get(w.member.id),
    ).toEqual({ cover_preset_id: preset });
  });

  test("neither", async () => {
    const w = world();
    expect((await one(w, w.member.id)).cover).toBeNull();
  });

  test("profiles.get shows the same cover", async () => {
    const w = world();
    allowPresets(w, w.member.id);
    const presetFile = w.file(w.admin.id, "cover_preset");
    const uploaded = w.file(w.member.id, "cover");
    w.set(w.member.id, {
      cover_preset_id: w.image("profile_cover", presetFile, { placement: false }),
      cover_file_id: uploaded,
    });
    const profile = await w.call("profiles.get", w.memberActor, { userId: w.member.id });
    expect(profile.cover).toEqual((await one(w, w.member.id)).cover);
    expect(profile.cover.fileId).toBe(presetFile);
  });
});

describe("users.authors: the rest of the block", () => {
  test("the full shape of a member", async () => {
    const w = world();
    const target = w.moderator;
    w.set(target.id, {
      post_count: 42,
      reaction_score: 7,
      award_xp: 350,
      signature_html: "<p>sig</p>",
    });
    const gold = w.award({ name: "Gold", tier: "gold", xp: 50 });
    w.hold(target.id, gold);
    const author = await one(w, target.id);
    expect(author).toMatchObject({
      card: { id: target.id, level: 3 },
      cover: null,
      postCount: 42,
      reactionScore: 7,
      awardXp: 350,
      currentLevelXp: 300,
      nextLevelXp: 600,
      signatureHtml: "<p>sig</p>",
    });
    expect(author.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(author.awards).toEqual([
      { id: gold, name: "Gold", icon: "", image: null, tier: "gold" },
    ]);
  });

  test("awards are cut to the slots, best tier first, then XP, then lowest id", async () => {
    const w = world();
    const bronzeA = w.award({ name: "bronzeA", tier: "bronze", xp: 900 });
    const silver = w.award({ name: "silver", tier: "silver", xp: 10 });
    const goldLow = w.award({ name: "goldLow", tier: "gold", xp: 5 });
    const goldHigh = w.award({ name: "goldHigh", tier: "gold", xp: 50 });
    const legendary = w.award({ name: "legendary", tier: "legendary", xp: 1 });
    const silverTwin = w.award({ name: "silverTwin", tier: "silver", xp: 10 });
    const sixth = w.award({ name: "extra", tier: "bronze", xp: 1 });
    for (const id of [bronzeA, silver, goldLow, goldHigh, legendary, silverTwin, sixth])
      w.hold(w.member.id, id);
    // A stackable award held twice is listed once; a revoked one (count 0) is not listed.
    const stack = w.award({ name: "stack", tier: "legendary", xp: 0, stackable: true });
    w.hold(w.member.id, stack, 2);
    const revoked = w.award({ name: "revoked", tier: "legendary", xp: 99 });
    w.hold(w.member.id, revoked, 0);
    const names = (await one(w, w.member.id)).awards.map((award) => award.name);
    // Registered members show five awards by default.
    expect(names).toEqual(["legendary", "stack", "goldHigh", "goldLow", "silver"]);
    expect(names.filter((name) => name === "stack")).toHaveLength(1);
  });

  test("the slot count is the member's own profile.awardSlots", async () => {
    const w = world();
    const first = w.award({ name: "first", tier: "gold", xp: 1 });
    const second = w.award({ name: "second", tier: "silver", xp: 1 });
    const third = w.award({ name: "third", tier: "bronze", xp: 1 });
    const slotted = w.group({ title: "Few", rank: 12 });
    w.ctx.sqlite.run(
      `INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ${slotted}, 0, 2 FROM permission_definitions WHERE key = 'profile.awardSlots'`,
    );
    const few = w.user({ groupId: slotted });
    const many = w.user();
    for (const user of [few, many]) for (const id of [first, second, third]) w.hold(user.id, id);
    // The viewer's own slots do not matter: an administrator sees the member's two.
    const asAdmin = await authors(w, [few.id, many.id], w.adminActor);
    const byId = new Map(asAdmin.map((author) => [author.card.id, author]));
    expect(byId.get(few.id)?.awards).toHaveLength(2);
    expect(byId.get(many.id)?.awards).toHaveLength(3);
  });

  test("inactive awards a member still holds are shown", async () => {
    const w = world();
    const old = w.award({ name: "old", tier: "gold", xp: 1, active: false });
    w.hold(w.member.id, old);
    expect((await one(w, w.member.id)).awards.map((award) => award.name)).toEqual(["old"]);
  });

  test("a member without profile.signature has no signature even with one stored", async () => {
    const w = world();
    w.set(w.member.id, { signature_html: "<p>stored</p>" });
    w.set(w.moderator.id, { signature_html: "<p>shown</p>" });
    expect((await one(w, w.member.id)).signatureHtml).toBeNull();
    expect((await one(w, w.moderator.id)).signatureHtml).toBe("<p>shown</p>");
  });

  test("unknown ids are left out and guests may ask", async () => {
    const w = world();
    const items = await authors(w, [w.member.id, 424242, w.member.id], GUEST);
    expect(items.map((author) => author.card.id)).toEqual([w.member.id]);
  });

  test("it takes 1 to 50 ids", async () => {
    const w = world();
    const ids = bulk(w.ctx, 50);
    expect(await authors(w, ids)).toHaveLength(50);
    await expect(authors(w, [...ids, w.member.id])).rejects.toBeInstanceOf(ValidationError);
    await expect(authors(w, [])).rejects.toBeInstanceOf(ValidationError);
  });

  test("a page costs the same number of statements for 1 and for 50 members", async () => {
    const w = world();
    const award = w.award({ name: "a", tier: "gold", xp: 1 });
    const preset = w.image("profile_cover", w.file(w.admin.id, "cover_preset"), {
      placement: false,
    });
    const ids = bulk(w.ctx, 50);
    for (const id of ids) {
      w.hold(id, award);
      w.set(id, { cover_preset_id: preset, signature_html: "<p>x</p>" });
    }
    await authors(w, ids);
    const single = await countStatements(w.ctx, () => authors(w, ids.slice(0, 1)));
    const many = await countStatements(w.ctx, () => authors(w, ids));
    expect(many - single).toBe(0);
    expect(many).toBeLessThanOrEqual(10);
  });
});
