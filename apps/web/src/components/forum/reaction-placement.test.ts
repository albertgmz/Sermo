import { describe, expect, test } from "bun:test";
import {
  BUBBLE_PX,
  PICKER_GAP_PX,
  type PickerPlacement,
  pickerGrid,
  placePicker,
  REACTION_MAX_PX,
  REACTION_PX,
  VIEWPORT_MARGIN_PX,
} from "./reaction-placement";

const phone = { width: 360, height: 640 };

// The picker's left edge on screen once placed, for a button whose left edge is `left`.
const leftEdge = (placement: PickerPlacement, left: number) =>
  left + placement.alignOffset;

describe("placePicker on a 360px phone", () => {
  test("goes above the button when it fits, with the bubble's room", () => {
    const placement = placePicker({
      anchor: { left: 40, top: 400, bottom: 440 },
      count: 6,
      viewport: phone,
    });
    expect(placement).toEqual({
      side: "top",
      sideOffset: PICKER_GAP_PX,
      alignOffset: 0,
      grid: { columns: 3, cell: REACTION_MAX_PX },
    });
  });

  test("flips below the button when there is no room above", () => {
    const placement = placePicker({
      anchor: { left: 40, top: 20, bottom: 60 },
      count: 6,
      viewport: phone,
    });
    expect(placement.side).toBe("bottom");
    // The bubble stands over the reaction, so the gap below also holds it.
    expect(placement.sideOffset).toBe(PICKER_GAP_PX + BUBBLE_PX);
  });

  test("needs the bubble's room too: a picker that only just fits above flips", () => {
    // Three reactions: two rows of 52px.
    const pickerHeight = 2 * REACTION_MAX_PX + 8;
    const top = pickerHeight + PICKER_GAP_PX + BUBBLE_PX;
    const fits = placePicker({
      anchor: { left: 40, top, bottom: top + 40 },
      count: 3,
      viewport: phone,
    });
    const tight = placePicker({
      anchor: { left: 40, top: top - 1, bottom: top + 39 },
      count: 3,
      viewport: phone,
    });
    expect(fits.side).toBe("top");
    expect(tight.side).toBe("bottom");
  });

  test("a button near the right edge shifts the picker left to stay on screen", () => {
    // Six reactions are three of 52px: 164px wide.
    const placement = placePicker({
      anchor: { left: 300, top: 400, bottom: 440 },
      count: 6,
      viewport: phone,
    });
    expect(leftEdge(placement, 300)).toBe(
      phone.width - VIEWPORT_MARGIN_PX - 164,
    );
  });

  test("a button at the left edge keeps the picker off the edge", () => {
    const placement = placePicker({
      anchor: { left: 4, top: 400, bottom: 440 },
      count: 6,
      viewport: phone,
    });
    expect(leftEdge(placement, 4)).toBe(VIEWPORT_MARGIN_PX);
  });

  test("twelve reactions fill the phone's width in two rows and stay inside the margins", () => {
    // Six of 52px: 320px wide of the 328px between the margins.
    const placement = placePicker({
      anchor: { left: 200, top: 500, bottom: 540 },
      count: 12,
      viewport: phone,
    });
    expect(placement.grid).toEqual({ columns: 6, cell: 52 });
    expect(leftEdge(placement, 200)).toBe(
      phone.width - VIEWPORT_MARGIN_PX - 328 + 8,
    );
    expect(placement.side).toBe("top");
  });

  test("a wrapped picker is taller, so it flips sooner", () => {
    const anchor = { left: 20, top: 120, bottom: 160 };
    const row = placePicker({ anchor, count: 1, viewport: phone });
    const rows = placePicker({ anchor, count: 40, viewport: phone });
    expect(row.side).toBe("top");
    expect(rows.side).toBe("bottom");
  });

  test("with no room on either side it takes the side with more", () => {
    const short = { width: 360, height: 150 };
    const nearTop = placePicker({
      anchor: { left: 20, top: 30, bottom: 70 },
      count: 6,
      viewport: short,
    });
    const nearBottom = placePicker({
      anchor: { left: 20, top: 80, bottom: 120 },
      count: 6,
      viewport: short,
    });
    expect(nearTop.side).toBe("bottom");
    expect(nearBottom.side).toBe("top");
  });
});

describe("pickerGrid", () => {
  test("two even rows, the first taking the extra one", () => {
    expect(pickerGrid(12, 360).columns).toBe(6);
    expect(pickerGrid(11, 360).columns).toBe(6);
    expect(pickerGrid(9, 1280).columns).toBe(5);
    expect(pickerGrid(1, 360).columns).toBe(1);
  });

  test("reactions are as large as the screen allows, never over the maximum", () => {
    expect(pickerGrid(12, 1280).cell).toBe(REACTION_MAX_PX);
    expect(pickerGrid(12, 360).cell).toBe(REACTION_MAX_PX);
    // A 320px phone: 280px for six, 46px each.
    expect(pickerGrid(12, 320)).toEqual({ columns: 6, cell: 46 });
  });

  test("never under the 40px touch target: many reactions take more rows", () => {
    // 320px between the margins on a 360px phone holds eight of 40px.
    expect(pickerGrid(20, 360)).toEqual({ columns: 8, cell: REACTION_PX });
    const { columns, cell } = pickerGrid(20, 360);
    expect(columns * cell + 8).toBeLessThanOrEqual(
      360 - 2 * VIEWPORT_MARGIN_PX,
    );
  });
});
