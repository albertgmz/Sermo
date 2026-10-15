import { OPTIONAL_CATEGORIES } from "./inventory";

// What the page must do once the visitor's choice has changed (the library has already deleted
// the cookies of every category now off):
// - "reload": a category that runs code in the page was withdrawn (the tracker, the players the
//   visitor loaded, which a server render cannot reach), so only a fresh page stops it;
// - "refresh": a category that changes what the server draws was accepted or changed otherwise;
// - "none": the change touches nothing the page shows.
export type Effect = "reload" | "refresh" | "none";

const RUNS_IN_PAGE = ["analytics", "embeds"];
const DRAWN_BY_SERVER = ["analytics", "embeds"];

export function effectOf(
  changed: readonly string[],
  accepted: readonly string[],
): Effect {
  const withdrawn = (category: string) =>
    changed.includes(category) && !accepted.includes(category);
  if (RUNS_IN_PAGE.some(withdrawn)) return "reload";
  if (
    DRAWN_BY_SERVER.some((category) => changed.includes(category)) &&
    OPTIONAL_CATEGORIES.some((category) => accepted.includes(category))
  )
    return "refresh";
  return "none";
}
