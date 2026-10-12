import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { mayCommentOnWall, mayCommentOnWalls } from "./shared";

test("the batch wall check gives the answer of the single check for every owner and viewer", () => {
  const ctx = createTestContext();
  const viewerUser = insertUser(ctx, { username: "viewer" });
  const staff = insertUser(ctx, { username: "staff", groupId: 4 });
  const owners = [
    ["open", "members"],
    ["followed", "followed"],
    ["followedByOwner", "followed"],
    ["private", "self"],
    ["ignoring", "members"],
    ["closed", "members"],
  ].map(([username, privacy]) => {
    const user = insertUser(ctx, { username: username! });
    ctx.sqlite
      .prepare("UPDATE users SET profile_post_privacy = ?1 WHERE id = ?2")
      .run(privacy!, user.id);
    return { username: username!, id: user.id };
  });
  const id = (name: string) => owners.find((owner) => owner.username === name)!.id;
  ctx.sqlite
    .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, 1)")
    .run(id("followedByOwner"), viewerUser.id);
  ctx.sqlite
    .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, 1)")
    .run(viewerUser.id, id("followed"));
  ctx.sqlite
    .prepare("INSERT INTO user_ignores (user_id, ignored_id, created_at) VALUES (?1, ?2, 1)")
    .run(id("ignoring"), viewerUser.id);
  ctx.sqlite
    .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
    .run(id("closed"));

  const ownerIds = [...owners.map((owner) => owner.id), viewerUser.id];
  for (const actor of [userActor(viewerUser), userActor(staff), GUEST]) {
    const batch = mayCommentOnWalls(ctx, actor, ownerIds);
    for (const ownerId of ownerIds)
      expect(batch.get(ownerId), `owner ${ownerId}`).toBe(mayCommentOnWall(ctx, actor, ownerId));
  }
  const member = mayCommentOnWalls(ctx, userActor(viewerUser), ownerIds);
  expect([...member.entries()].filter(([, allowed]) => allowed).length).toBeGreaterThan(0);
  expect(member.get(id("private"))).toBe(false);
  expect(member.get(id("ignoring"))).toBe(false);
  expect(member.get(id("closed"))).toBe(false);
  expect(member.get(id("followedByOwner"))).toBe(true);
  expect(member.get(viewerUser.id)).toBe(true);
});
