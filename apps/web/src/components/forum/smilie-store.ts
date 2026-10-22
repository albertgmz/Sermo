import type { Smilie } from "@/lib/smilies";

// The site's smilies in the browser, asked once per page for the emoji picker and the ":" list.
// A failed ask leaves none (the emoji are still offered) and is asked again next time.
let known: Smilie[] = [];
let asking: Promise<Smilie[]> | undefined;

export const knownSmilies = () => known;

export function loadSmilies(ask: () => Promise<Smilie[]>) {
  asking ??= ask().then(
    (smilies) => {
      known = smilies;
      return smilies;
    },
    () => {
      asking = undefined;
      return known;
    },
  );
  return asking;
}
