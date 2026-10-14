import "server-only";

import {
  appearanceGet,
  profilesSelf,
  shopInventory,
} from "@sermo/core/contracts";
import { cache } from "react";
import { read } from "@/lib/sermo/client";

// Asked once per request for every section of a page.
export const getSelf = cache(() => read(profilesSelf, {}));
export const getWorn = cache(() => read(appearanceGet, {}));

// How many username changes the member holds: the units left of the `usernameChange` items they
// have not used up.
export const getRenameUnits = cache(async (): Promise<number> => {
  let units = 0;
  let cursor: string | undefined;
  do {
    const page = await read(shopInventory, {
      state: "unused",
      cursor,
      limit: 100,
    });
    for (const entry of page.items) {
      if (entry.item.effect.type === "usernameChange") units += entry.quantity;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return units;
});

export const shopHref = "/credits";
