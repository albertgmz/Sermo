import {
  WIDGET_PAGE_POSITIONS,
  WIDGET_PAGES,
  WidgetPosition,
} from "@sermo/core/contracts";
import type * as z from "zod";

// What the panel knows of the positions without asking the web app what it draws (that is
// `drawn.ts`): the actions read this file, and it must not bring the widget components with it.
export type Position = z.output<typeof WidgetPosition>;
export type Page = (typeof WIDGET_PAGES)[number];

// Every position, in the order the backend lists the widgets in.
export const POSITIONS: readonly Position[] = WidgetPosition.options;

// The pages the contract plans a position for, whether or not the web app draws them yet.
export const pagesOf = (position: Position): Page[] =>
  WIDGET_PAGES.filter((page) =>
    (WIDGET_PAGE_POSITIONS[page] as readonly string[]).includes(position),
  );

export const asPosition = (value: string): Position | null =>
  (POSITIONS as readonly string[]).includes(value) ? (value as Position) : null;
