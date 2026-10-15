import { describe, expect, test } from "bun:test";
import {
  BUBBLE_PX,
  PICKER_GAP_PX,
  type PickerPlacement,
  placePicker,
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
    const pickerHeight = REACTION_PX + 8;
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
    // Six reactions are 248px wide.
    const placement = placePicker({
      anchor: { left: 300, top: 400, bottom: 440 },
      count: 6,
      viewport: phone,
    });
    expect(leftEdge(placement, 300)).toBe(
      phone.width - VIEWPORT_MARGIN_PX - 248,
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

  test("more reactions than fit in a row wrap and still stay inside the margins", () => {
    // Ten reactions: 408px wide in one row, so two rows of 8 in 328px; 88px tall.
    const placement = placePicker({
      anchor: { left: 200, top: 500, bottom: 540 },
      count: 10,
      viewport: phone,
    });
    expect(leftEdge(placement, 200)).toBe(VIEWPORT_MARGIN_PX);
    expect(placement.side).toBe("top");
  });

  test("a wrapped picker is taller, so it flips sooner", () => {
    const anchor = { left: 20, top: 120, bottom: 160 };
    const row = placePicker({ anchor, count: 6, viewport: phone });
    const rows = placePicker({ anchor, count: 24, viewport: phone });
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
