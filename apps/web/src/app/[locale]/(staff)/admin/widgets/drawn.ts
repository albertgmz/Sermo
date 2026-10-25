import { WIDGET_PAGES } from "@sermo/core/contracts";
import { WIDGET_ENTRIES } from "@/components/widgets/registry";
import { DRAWN_PAGES, DRAWN_POSITIONS } from "@/components/widgets/widget-area";
import { type Page, POSITIONS, type Position } from "./positions";

// What the web app draws, for the screens that say where a widget shows. A widget of a type, or in
// a position, it does not draw yet is kept and editable, and the panel says it is not shown.
export const typeDrawn = (type: string) => Object.hasOwn(WIDGET_ENTRIES, type);

// The pages that draw a position, in the order the contract lists them; none when no page does.
export const pagesDrawn = (position: Position): Page[] =>
  WIDGET_PAGES.filter(
    (page) =>
      Object.hasOwn(DRAWN_PAGES, page) &&
      (DRAWN_PAGES as Record<string, readonly string[]>)[page]?.includes(
        position,
      ),
  );

export const positionDrawn = (position: Position) =>
  pagesDrawn(position).length > 0;

// Every position as the lists and selects show them: the drawn ones in the order the pages draw
// them (the home page's, then What's new's), the others after them.
export const POSITIONS_IN_ORDER: readonly Position[] = [
  ...DRAWN_POSITIONS,
  ...POSITIONS.filter((position) => !DRAWN_POSITIONS.includes(position)),
];

// The address of each page that draws widgets and has one of its own, to look at one.
export const PAGE_ADDRESSES: Partial<Record<Page, string>> = {
  home: "/",
  whats_new: "/whats-new",
  members: "/members",
};
