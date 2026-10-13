import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { ValidationError } from "../../errors";
import { expectNoTableScan } from "../../testing";
import { countStatements } from "../feed/fixtures.test";
import { AVATAR_VARIANTS_SQL, HELD_AWARDS_SQL, MEMBER_GROUPS_SQL, MEMBER_ROWS_SQL } from "./cards";
import { bulk, world } from "./fixtures.test";

type Card = {
  id: number;
  username: string;
  avatar: { url: string; smallUrl: string } | null;
  frame: { url: string; placement: object } | null;
  nameColor: string | null;
  title: string;
  badges: { label: string; color: string | null; style: string }[];
  level: number;
};
const cards = async (w: ReturnType<typeof world>, ids: number[], actor: object = w.memberActor) =>
  (await w.call("users.cards", actor, { userIds: ids })).items as Card[];
const one = async (w: ReturnType<typeof world>, id: number) => (await cards(w, [id]))[0]!;

describe("users.cards", () => {
  test("a member with nothing set", async () => {
    const w = world();
    expect(await one(w, w.member.id)).toEqual({
      id: w.member.id,
      username: w.member.username,
      avatar: null,
      frame: null,
      nameColor: null,
      title: "Member",
      badges: [],
      level: 1,
      restricted: false,
    });
  });

  test("a member with everything set", async () => {
    const w = world();
    const target = w.moderator;
    const avatar = w.file(target.id, "avatar");
    const small = w.file(target.id, "avatar", { parent: avatar, variant: "square_128" });
    w.file(target.id, "avatar", { parent: avatar, variant: "square_64" });
    const frameFile = w.file(target.id, "frame");
    const frame = w.image("frame", frameFile);
    const color = w.color("name", "#aa0000");
    w.set(target.id, {
      avatar_file_id: avatar,
      frame_id: frame,
      name_color_id: color,
      custom_title: "Keeper of the keys",
      award_xp: 300,
    });
    const card = await one(w, target.id);
    expect(card.avatar).toEqual({
      url: `/api/v1/files/${avatar}`,
      smallUrl: `/api/v1/files/${small}`,
    });
    expect(card.frame).toEqual({
      url: `/api/v1/files/${frameFile}`,
      placement: { width: 120, left: -10, top: -10, scale: 80 },
    });
    expect(card.nameColor).toBe("#aa0000");
    expect(card.title).toBe("Keeper of the keys");
    expect(card.badges).toEqual([{ label: "Moderator", color: null, style: "moderator" }]);
    expect(card.level).toBe(3);
  });

  test("an avatar without a small rendition falls back to the main url", async () => {
    const w = world();
    const avatar = w.file(w.member.id, "avatar");
    w.set(w.member.id, { avatar_file_id: avatar });
    expect((await one(w, w.member.id)).avatar).toEqual({
      url: `/api/v1/files/${avatar}`,
      smallUrl: `/api/v1/files/${avatar}`,
    });
  });

  test("an inactive colour and an inactive frame still show", async () => {
    const w = world();
    const frameFile = w.file(w.member.id, "frame");
    w.set(w.member.id, {
      frame_id: w.image("frame", frameFile, { active: false }),
      name_color_id: w.color("name", "#00aa00", false),
    });
    const card = await one(w, w.member.id);
    expect(card.nameColor).toBe("#00aa00");
    expect(card.frame?.url).toBe(`/api/v1/files/${frameFile}`);
  });

  test("a frame without a picture or without a placement is null", async () => {
    const w = world();
    const noPicture = w.image("frame", null);
    const noPlacement = w.image("frame", w.file(w.member.id, "frame"), { placement: false });
    const other = w.user();
    w.set(w.member.id, { frame_id: noPicture });
    w.set(other.id, { frame_id: noPlacement });
    expect((await one(w, w.member.id)).frame).toBeNull();
    expect((await one(w, other.id)).frame).toBeNull();
  });

  test("a custom title shows only while the member holds profile.customTitle", async () => {
    const w = world();
    w.set(w.member.id, { custom_title: "Wizard" });
    expect((await one(w, w.member.id)).title).toBe("Member");
    w.set(w.moderator.id, { custom_title: "Wizard" });
    expect((await one(w, w.moderator.id)).title).toBe("Wizard");
    // Losing the permission keeps the text stored and stops showing it.
    w.ctx.sqlite.run(`UPDATE users SET group_id = 2 WHERE id = ${w.moderator.id}`);
    expect((await one(w, w.moderator.id)).title).toBe("Member");
    expect(
      w.ctx.sqlite
        .prepare<{ custom_title: string }, [number]>("SELECT custom_title FROM users WHERE id = ?1")
        .get(w.moderator.id)?.custom_title,
    ).toBe("Wizard");
  });

  test("the title falls back to the display group's, then to the level's", async () => {
    const w = world();
    const bare = w.group({ title: "Bare", rank: 30 });
    const user = w.user({ groupId: bare });
    expect((await one(w, user.id)).title).toBe("New member");
    w.set(user.id, { award_xp: 100 });
    expect((await one(w, user.id)).title).toBe("Member");
    w.set(user.id, { award_xp: 600 });
    expect((await one(w, user.id)).title).toBe("Senior member");
    w.ctx.sqlite.run(`UPDATE groups SET user_title = 'Elder' WHERE id = ${bare}`);
    expect((await one(w, user.id)).title).toBe("Elder");
  });

  test("badges come from every group the member holds, highest rank first", async () => {
    const w = world();
    const red = w.color("name", "#cc0000");
    const blue = w.color("name", "#0000cc");
    const vip = w.group({
      title: "VIP",
      rank: 20,
      badge: "vip",
      userTitle: "Very important",
      nameColorId: red,
    });
    const patron = w.group({ title: "Patron", rank: 25, badge: "patron", nameColorId: blue });
    const quiet = w.group({ title: "Quiet", rank: 40 });
    const sameRank = w.group({ title: "Also VIP", rank: 20, badge: "vip2" });
    const byHand = w.user();
    const promoted = w.user();
    const bought = w.user();
    const all = w.user();
    const sql = w.ctx.sqlite;
    sql.run(
      `INSERT INTO user_groups (user_id, group_id, created_at) VALUES (${byHand.id}, ${vip}, 0), (${all.id}, ${vip}, 0), (${all.id}, ${patron}, 0), (${all.id}, ${quiet}, 0), (${all.id}, ${sameRank}, 0)`,
    );
    sql.run("PRAGMA foreign_keys = OFF");
    sql.run(
      `INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (${promoted.id}, 1, ${vip}, 0)`,
    );
    sql.run(
      `INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (${bought.id}, 1, ${vip}, 0)`,
    );
    for (const user of [byHand, promoted, bought]) {
      const card = await one(w, user.id);
      expect(card.badges).toEqual([{ label: "VIP", color: "#cc0000", style: "vip" }]);
      expect(card.title).toBe("Very important");
      expect(card.nameColor).toBe("#cc0000");
    }
    const everything = await one(w, all.id);
    expect(everything.badges.map((badge) => badge.label)).toEqual(["Patron", "VIP", "Also VIP"]);
    // The highest-ranked group with a colour decides the name colour: Patron (25) beats VIP (20).
    expect(everything.nameColor).toBe("#0000cc");
    // The display group is Quiet (rank 40) and has no user title, so the level title follows.
    expect(everything.title).toBe("New member");
  });

  test("the title and first badge agree with the display group of profiles.get", async () => {
    const w = world();
    const low = w.group({ title: "Low", rank: 20, badge: "low", userTitle: "Lowly" });
    const mid = w.group({ title: "Mid", rank: 25, badge: "mid", userTitle: "Middling" });
    const high = w.group({ title: "High", rank: 35, badge: "high" });
    const top = w.group({ title: "Top", rank: 50, badge: "top", userTitle: "Topmost" });
    const sql = w.ctx.sqlite;
    sql.run("PRAGMA foreign_keys = OFF");
    const cases = [
      { by: [low, mid], promoted: [], bought: [] },
      { by: [low], promoted: [mid], bought: [] },
      { by: [], promoted: [low], bought: [high] },
      { by: [low], promoted: [mid], bought: [high] },
      { by: [mid], promoted: [top], bought: [low, high] },
      { by: [], promoted: [], bought: [top] },
    ];
    for (const grants of cases) {
      const user = w.user();
      for (const id of grants.by)
        sql.run(
          `INSERT INTO user_groups (user_id, group_id, created_at) VALUES (${user.id}, ${id}, 0)`,
        );
      for (const id of grants.promoted)
        sql.run(
          `INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (${user.id}, ${user.id}, ${id}, 0)`,
        );
      for (const id of grants.bought)
        sql.run(
          `INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (${user.id}, ${user.id}, ${id}, 0)`,
        );
      const profile = await w.call("profiles.get", w.memberActor, { userId: user.id });
      const display = profile.displayGroup;
      expect(display).not.toBeNull();
      const card = await one(w, user.id);
      expect(card.title).toBe(display.userTitle !== "" ? display.userTitle : "New member");
      expect(card.badges[0]?.label).toBe(display.title);
      expect(profile.card).toEqual(card);
    }
  });

  test("the member's own name colour beats a group's", async () => {
    const w = world();
    const groupColor = w.color("name", "#111111");
    const group = w.group({ title: "G", rank: 15, nameColorId: groupColor });
    const user = w.user({ groupId: group });
    expect((await one(w, user.id)).nameColor).toBe("#111111");
    w.set(user.id, { name_color_id: w.color("name", "#222222") });
    expect((await one(w, user.id)).nameColor).toBe("#222222");
  });

  test("banned members still have a card", async () => {
    const w = world();
    const banned = w.user();
    w.set(banned.id, { banned_permanently: 1 });
    expect((await one(w, banned.id)).username).toBe(banned.username);
  });

  test("unknown ids are left out, repeated ids are returned once", async () => {
    const w = world();
    const items = await cards(w, [w.member.id, 99999, w.member.id, w.admin.id]);
    expect(items.map((card) => card.id).sort()).toEqual([w.member.id, w.admin.id].sort());
  });

  test("it is open to guests and takes 1 to 100 ids", async () => {
    const w = world();
    expect(await cards(w, [w.member.id], GUEST)).toHaveLength(1);
    const ids = bulk(w.ctx, 100);
    expect(await cards(w, ids)).toHaveLength(100);
    await expect(cards(w, [...ids, w.member.id])).rejects.toBeInstanceOf(ValidationError);
    await expect(cards(w, [])).rejects.toBeInstanceOf(ValidationError);
  });

  test("a page costs the same number of statements for 1 and for 50 members", async () => {
    const w = world();
    const color = w.color("name", "#123456");
    const group = w.group({ title: "G", rank: 15, badge: "g", nameColorId: color });
    const frame = w.image("frame", w.file(w.member.id, "frame"));
    const ids = bulk(w.ctx, 50, group);
    for (const id of ids) {
      const avatar = w.file(id, "avatar");
      w.file(id, "avatar", { parent: avatar, variant: "square_128" });
      w.set(id, { avatar_file_id: avatar, frame_id: frame, custom_title: "x" });
    }
    await cards(w, ids);
    const single = await countStatements(w.ctx, () => cards(w, ids.slice(0, 1)));
    const many = await countStatements(w.ctx, () => cards(w, ids));
    const page = await cards(w, ids);
    expect(page).toHaveLength(50);
    expect(page.every((card) => card.avatar?.smallUrl !== card.avatar?.url)).toBe(true);
    expect(many - single).toBe(0);
    expect(many).toBeLessThanOrEqual(10);
  });

  test("the card queries use indexes", () => {
    const w = world();
    expectNoTableScan(w.ctx, MEMBER_ROWS_SQL, ["[1,2]"]);
    expectNoTableScan(w.ctx, MEMBER_GROUPS_SQL, ["[1,2]"]);
    expectNoTableScan(w.ctx, AVATAR_VARIANTS_SQL, ["[1,2]"]);
    expectNoTableScan(w.ctx, HELD_AWARDS_SQL, ["[1,2]"]);
  });
});
