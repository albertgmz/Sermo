import {
  WIDGET_PAGE_POSITIONS,
  WIDGET_PAGES,
  WidgetPosition,
} from "@sermo/core/contracts";
import type * as z from "zod";
import { WIDGET_ENTRIES } from "@/components/widgets/registry";
import { DRAWN_POSITIONS } from "@/components/widgets/widget-area";

export type Position = z.output<typeof WidgetPosition>;
export type Page = (typeof WIDGET_PAGES)[number];

// Every position, in the order the backend lists the widgets in.
export const POSITIONS: readonly Position[] = WidgetPosition.options;

// The pages that have a position, in the order the contract lists them.
export const pagesOf = (position: Position): Page[] =>
  WIDGET_PAGES.filter((page) =>
    (WIDGET_PAGE_POSITIONS[page] as readonly string[]).includes(position),
  );

export const asPosition = (value: string): Position | null =>
  (POSITIONS as readonly string[]).includes(value) ? (value as Position) : null;

// Whether the web app draws a position, and a widget type, yet. A widget in either is kept and
// editable, and the panel says it is not shown.
export const positionDrawn = (position: Position) =>
  DRAWN_POSITIONS.has(position);
export const typeDrawn = (type: string) => Object.hasOwn(WIDGET_ENTRIES, type);

// The address of each page that draws widgets, to look at one.
export const PAGE_ADDRESSES: Partial<Record<Page, string>> = {
  home: "/",
  novedades: "/novedades",
};
