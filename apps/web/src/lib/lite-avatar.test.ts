import assert from "node:assert/strict";
import { test } from "node:test";
import { liteAvatarLayout } from "./lite-avatar";
import { parseLiteCookie } from "./lite-preferences";
import type { MemberView } from "./sermo/views";

const frame: NonNullable<MemberView["frame"]> = {
  url: "https://pictures.test/frame.png",
  placement: { width: 170.5, left: -33.2, top: -30.1, scale: 92 },
};

test("every LITE selection preserves equipped frame placement", () => {
  for (const cookie of ["", "avatars", "frames", "avatars.frames", "all"]) {
    const layout = liteAvatarLayout(parseLiteCookie(cookie), frame);
    assert.deepEqual(layout.placement, frame.placement);
    assert.equal(
      layout.hideAvatar,
      ["avatars", "avatars.frames", "all"].includes(cookie),
    );
    assert.equal(
      layout.frame,
      ["frames", "avatars.frames", "all"].includes(cookie) ? null : frame,
    );
  }
});

test("unframed avatars have no frame transform", () => {
  const layout = liteAvatarLayout(parseLiteCookie("all"), null);
  assert.equal(layout.placement, undefined);
  assert.equal(layout.frame, null);
});
