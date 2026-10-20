// How the reaction picker is laid out and where it goes: two even rows of large reactions while
// they fit, above the button while it fits with the name bubble over the reaction under the
// finger, below it otherwise, and never past the screen's edges.

// The smallest a reaction may be: the 40px touch target. The picker pads its rows by 4px (`p-1`).
export const REACTION_PX = 40;
// The largest a reaction is drawn: six of them fill a 360px phone (6 x 52 + 8 = 320px of 328px).
export const REACTION_MAX_PX = 52;
export const PICKER_PADDING_PX = 4;
// The name bubble stands above the reaction under the finger.
export const BUBBLE_PX = 32;
export const PICKER_GAP_PX = 4;
// Matches `max-w-[calc(100vw-2rem)]` in the picker's class.
export const VIEWPORT_MARGIN_PX = 16;

export type PickerGrid = {
  // How many reactions each row holds, top row first.
  rows: number[];
  // The side of one reaction's square, in pixels.
  cell: number;
};

export type PickerPlacement = {
  side: "top" | "bottom";
  // The gap to the button; below it also leaves room for the bubble, which stands above the
  // reaction and would cover the button.
  sideOffset: number;
  // How far the picker shifts along the button's left edge to stay on screen.
  alignOffset: number;
  grid: PickerGrid;
};

// Two rows of half the reactions each (with an odd count the first row takes the extra one); one
// row for one or two reactions. When half the reactions would not fit at the 40px target, the
// fewest rows that do, which differ by at most one (the first rows take the extras). Each
// reaction is as large as the screen allows for the widest row, up to `REACTION_MAX_PX`.
export function pickerGrid(count: number, viewportWidth: number): PickerGrid {
  const room = viewportWidth - 2 * VIEWPORT_MARGIN_PX - 2 * PICKER_PADDING_PX;
  const fit = Math.max(1, Math.floor(room / REACTION_PX));
  const total = Math.max(1, count);
  const rowCount = Math.min(
    total,
    Math.max(total <= 2 ? 1 : 2, Math.ceil(total / fit)),
  );
  const base = Math.floor(total / rowCount);
  const extra = total % rowCount;
  const rows = Array.from(
    { length: rowCount },
    (_, index) => base + Number(index < extra),
  );
  const widest = base + Number(extra > 0);
  const cell = Math.max(
    REACTION_PX,
    Math.min(REACTION_MAX_PX, Math.floor(room / widest)),
  );
  return { rows, cell };
}

export function placePicker({
  anchor,
  count,
  viewport,
}: {
  anchor: { left: number; top: number; bottom: number };
  count: number;
  viewport: { width: number; height: number };
}): PickerPlacement {
  const grid = pickerGrid(count, viewport.width);
  const width = (grid.rows[0] ?? 1) * grid.cell + 2 * PICKER_PADDING_PX;
  const height = grid.rows.length * grid.cell + 2 * PICKER_PADDING_PX;

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
    grid,
  };
}
