// A guest's header at 360 px in English holds six controls: the menu, the logo mark, Search, Site
// options, the sign-in icon and "Create Account". Together they were 18 px wider than the 328 px
// the header's content box gives them, which pushed the page 2 px past the screen (the layout
// viewport, and so the cookie banner, became 362 px wide). Below `md` a guest's Create Account
// button is a little smaller and the tools row closes up; a signed-in member's header, which has
// fewer controls on a phone, and every header from `md` up keep their usual sizes.
export const REGISTER_BUTTON = "px-2 text-[0.8125rem] md:px-3 md:text-sm";
// The tools row: its usual gaps, and below `md` a closer one that matches only a row that holds the
// guest's controls (`data-guest-tools`).
export const HEADER_TOOLS =
  "ml-auto flex items-center gap-1 md:gap-2 max-md:has-[[data-guest-tools]]:gap-0.5";
