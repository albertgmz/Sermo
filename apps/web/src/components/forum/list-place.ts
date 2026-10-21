import { useEffect } from "react";
import { placeHref, writePlace } from "@/lib/list-pages";

// Keeps the number of pages loaded in the address (`?pages=N`) while `wanted` is read (null until
// then, so the address is not touched before it is). Written again at every new draw of the screen
// (`stamp`): a refresh of the router, such as marking an alert read, makes Next write the address
// it knew over the one written here, and the place would go until the next press of Load more.
// The effect runs after Next's own write in the same commit, so this one lands last.
export function useListPlace({
  count,
  owed,
  wanted,
  stamp,
}: {
  count: number;
  owed: boolean;
  wanted: number | null;
  stamp: number;
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stamp` is only a reason to write again
  useEffect(() => {
    if (wanted === null) return;
    const here = `${location.pathname}${location.search}${location.hash}`;
    const place = placeHref(here, owed ? wanted : count);
    if (place !== here) writePlace(window.history, place);
  }, [count, owed, wanted, stamp]);
}
