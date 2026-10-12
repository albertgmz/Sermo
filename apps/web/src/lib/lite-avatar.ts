import { blocks, type LiteState } from "./lite-preferences";
import type { MemberView } from "./sermo/views";

export function liteAvatarLayout(
  state: LiteState,
  equippedFrame: MemberView["frame"],
) {
  return {
    hideAvatar: blocks(state, "avatars"),
    frame: blocks(state, "frames") ? null : equippedFrame,
    placement: equippedFrame?.placement,
  };
}
