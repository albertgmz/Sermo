import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { PROFILE_VIEW_PRIVACY } from "../../db/schema";
import { userActor } from "../../testing";
import { countStatements } from "../feed/fixtures.test";
import { bulk, world } from "./fixtures.test";

/** A target whose privacy is set, followed by the member `follower` (who then sees "followed"). */
function scene(privacy: (typeof PROFILE_VIEW_PRIVACY)[number]) {
  const w = world();
  const target = w.user({ username: "Target" });
  const stranger = w.user();
  const follower = w.user();
  w.set(target.id, {
    profile_view_privacy: privacy,
    signature_html: "<p>sig</p>",
    post_count: 12,
    reaction_score: 34,
    award_xp: 50,
  });
  w.ctx.sqlite
    .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, 0)")
    .run(target.id, follower.id);
  return {
    w,
    target,
    viewers: {
      guest: GUEST,
      member: userActor(stranger),
      follower: userActor(follower),
      self: userActor(target),
      staff: w.moderatorActor,
      admin: w.adminActor,
    },
  };
}

/** Who may not open the profile, by privacy setting. Staff bypass it; the target always can. */
const RESTRICTED: Record<(typeof PROFILE_VIEW_PRIVACY)[number], Record<string, boolean>> = {
  everyone: {
    guest: false,
    member: false,
    follower: false,
    self: false,
    staff: false,
    admin: false,
  },
  members: { guest: true, member: false, follower: false, self: false, staff: false, admin: false },
  followed: { guest: true, member: true, follower: false, self: false, staff: false, admin: false },
  self: { guest: true, member: true, follower: true, self: false, staff: false, admin: false },
};

describe("users.cards and users.authors respect profile privacy", () => {
  for (const privacy of PROFILE_VIEW_PRIVACY)
    for (const [who, expected] of Object.entries(RESTRICTED[privacy])) {
      test(`${privacy}: ${who} gets a ${expected ? "minimal" : "full"} card and author`, async () => {
        const s = scene(privacy);
        const actor = s.viewers[who as keyof typeof s.viewers];
        const card = (await s.w.call("users.cards", actor, { userIds: [s.target.id] })).items[0];
        const author = (await s.w.call("users.authors", actor, { userIds: [s.target.id] }))
          .items[0];
        expect(card.restricted).toBe(expected);
        expect(author.card.restricted).toBe(expected);
        expect(card.username).toBe("Target");
        if (expected) {
          expect(card.title).toBe("");
          expect(card.level).toBe(1);
          expect(author).toMatchObject({
            cover: null,
            createdAt: "1970-01-01T00:00:00.000Z",
            postCount: 0,
            reactionScore: 0,
            awardXp: 0,
            currentLevelXp: 0,
            nextLevelXp: 1,
            awards: [],
            signatureHtml: null,
          });
        } else {
          expect(card.title).toBe("Member");
          expect(author.postCount).toBe(12);
          expect(author.reactionScore).toBe(34);
        }
      });
    }

  test("a minimal card keeps what is drawn next to a post", async () => {
    const s = scene("self");
    const group = s.w.group({ title: "Crew", rank: 15, badge: "crew" });
    s.w.set(s.target.id, { group_id: group });
    s.w.ctx.sqlite
      .prepare(
        "INSERT OR IGNORE INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)",
      )
      .run(s.target.id, group);
    const card = (await s.w.call("users.cards", GUEST, { userIds: [s.target.id] })).items[0];
    expect(card.restricted).toBe(true);
    expect(card.badges).toEqual([{ label: "Crew", color: null, style: "crew" }]);
  });

  test("a minimal card carries no name icon, the full card does", async () => {
    const s = scene("self");
    s.w.set(s.target.id, { name_icon_item_id: s.w.iconItem("star", "before") });
    const minimal = (await s.w.call("users.cards", GUEST, { userIds: [s.target.id] })).items[0];
    expect(minimal.restricted).toBe(true);
    expect(minimal.nameIcon).toBeNull();
    const full = (await s.w.call("users.cards", s.viewers.self, { userIds: [s.target.id] }))
      .items[0];
    expect(full.nameIcon).toEqual({ icon: "star", position: "before" });
  });

  test("a guest without profile.view gets minimal cards for every member, not the walk", async () => {
    const w = world();
    await w.call("permissions.set", w.adminActor, {
      groupId: 1,
      entries: [{ permission: "profile.view", value: "never" }],
    });
    const card = (await w.call("users.cards", GUEST, { userIds: [w.member.id] })).items[0];
    expect(card).toMatchObject({ id: w.member.id, restricted: true, title: "" });
    const author = (await w.call("users.authors", GUEST, { userIds: [w.member.id] })).items[0];
    expect(author).toMatchObject({ postCount: 0, createdAt: "1970-01-01T00:00:00.000Z" });
    // A member's own card is theirs whatever the permission.
    const own = (await w.call("users.cards", w.memberActor, { userIds: [w.member.id] })).items[0];
    expect(own.restricted).toBe(false);
  });

  test("the statements for a page do not grow with its size", async () => {
    const w = world();
    const ids = bulk(w.ctx, 50);
    for (const [index, id] of ids.entries())
      w.set(id, { profile_view_privacy: PROFILE_VIEW_PRIVACY[index % 4]! });
    const run = (name: string, actor: object, list: number[]) => () =>
      w.call(name, actor, { userIds: list });
    for (const [name, actor] of [
      ["users.cards", GUEST],
      ["users.cards", w.memberActor],
      ["users.authors", GUEST],
      ["users.authors", w.memberActor],
    ] as const) {
      await run(name, actor, ids)();
      const single = await countStatements(w.ctx, run(name, actor, ids.slice(0, 1)));
      const many = await countStatements(w.ctx, run(name, actor, ids));
      expect({ name, growth: many - single }).toEqual({ name, growth: 0 });
    }
  });
});
