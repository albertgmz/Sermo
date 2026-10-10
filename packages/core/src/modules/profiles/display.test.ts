import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { execute } from "../../operation";
import { createTestContext, insertUser, userActor } from "../../testing";
import { authMeOp } from "../auth";
import { profilesGetOp } from "./index";

describe("display group", () => {
  test("a member displays their highest-ranked group's title and badge", async () => {
    const ctx = createTestContext();
    const member = insertUser(ctx);
    const profile = () => execute(ctx, profilesGetOp, GUEST, { userId: member.id });
    expect((await profile()).displayGroup).toEqual({
      id: 2,
      title: "Member",
      userTitle: "Member",
      badge: "",
    });
    const veteran = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank, user_title, badge) VALUES ('Veterans', 30, 'Veteran', 'veteran') RETURNING id",
      )
      .get()!.id;
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(member.id, veteran);
    expect((await profile()).displayGroup).toEqual({
      id: veteran,
      title: "Veterans",
      userTitle: "Veteran",
      badge: "veteran",
    });
    // The primary group title is unchanged; rank is display only.
    expect((await profile()).groupTitle).toBe("Member");
    const me = await execute(ctx, authMeOp, userActor(member), {});
    expect(me.user?.displayGroup?.id).toBe(veteran);
    expect((await execute(ctx, authMeOp, GUEST, {})).user).toBeNull();
  });
});
