// Where the reaction picker goes: above the button while it fits with the name bubble over the
// reaction under the finger, below it otherwise, and never past the screen's edges.

// A reaction is the 40px touch target (`size-10`); the picker pads its rows by 4px (`p-1`).
export const REACTION_PX = 40;
export const PICKER_PADDING_PX = 4;
// The name bubble stands above the reaction under the finger.
export const BUBBLE_PX = 32;
export const PICKER_GAP_PX = 4;
// Matches `max-w-[calc(100vw-2rem)]` in the picker's class.
export const VIEWPORT_MARGIN_PX = 16;

export type PickerPlacement = {
  side: "top" | "bottom";
  // The gap to the button; below it also leaves room for the bubble, which stands above the
  // reaction and would cover the button.
  sideOffset: number;
  // How far the picker shifts along the button's left edge to stay on screen.
  alignOffset: number;
};

export function placePicker({
  anchor,
  count,
  viewport,
}: {
  anchor: { left: number; top: number; bottom: number };
  count: number;
  viewport: { width: number; height: number };
}): PickerPlacement {
  const width = Math.min(
    REACTION_PX * count + 2 * PICKER_PADDING_PX,
    viewport.width - 2 * VIEWPORT_MARGIN_PX,
  );
  const perRow = Math.max(
    1,
    Math.floor((width - 2 * PICKER_PADDING_PX) / REACTION_PX),
  );
  const height =
    Math.ceil(count / perRow) * REACTION_PX + 2 * PICKER_PADDING_PX;

  const left = Math.min(
    Math.max(anchor.left, VIEWPORT_MARGIN_PX),
    Math.max(VIEWPORT_MARGIN_PX, viewport.width - VIEWPORT_MARGIN_PX - width),
  );

  const need = height + PICKER_GAP_PX + BUBBLE_PX;
  const above = anchor.top;
  const below = viewport.height - anchor.bottom;
  // Above while it fits; when neither side fits, the side with more room.
  const top = above >= need || (below < need && above >= below);
  return {
    side: top ? "top" : "bottom",
    sideOffset: top ? PICKER_GAP_PX : PICKER_GAP_PX + BUBBLE_PX,
    alignOffset: left - anchor.left,
  };
}
