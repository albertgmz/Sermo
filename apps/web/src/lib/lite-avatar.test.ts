import assert from "node:assert/strict";
import { test } from "node:test";
import { FRAMES } from "./frames";
import { liteAvatarLayout } from "./lite-avatar";
import { parseLiteCookie } from "./lite-preferences";

test("every LITE selection preserves equipped frame geometry", () => {
  for (const cookie of ["", "avatars", "frames", "avatars.frames", "all"]) {
    const layout = liteAvatarLayout(parseLiteCookie(cookie), "619");
    assert.deepEqual(layout.geometry, FRAMES["619"]);
    assert.equal(
      layout.hideAvatar,
      ["avatars", "avatars.frames", "all"].includes(cookie),
    );
    assert.equal(
      layout.frame,
      ["frames", "avatars.frames", "all"].includes(cookie) ? null : "619",
    );
  }
});

test("unframed avatars have no frame transform", () => {
  const layout = liteAvatarLayout(parseLiteCookie("all"), null);
  assert.equal(layout.geometry, undefined);
  assert.equal(layout.frame, null);
});
