import { FRAMES } from "./frames";
import { blocks, type LiteState } from "./lite-preferences";

export function liteAvatarLayout(
  state: LiteState,
  equippedFrame: string | null,
) {
  return {
    hideAvatar: blocks(state, "avatars"),
    frame: blocks(state, "frames") ? null : equippedFrame,
    geometry: equippedFrame ? FRAMES[equippedFrame] : undefined,
  };
}
