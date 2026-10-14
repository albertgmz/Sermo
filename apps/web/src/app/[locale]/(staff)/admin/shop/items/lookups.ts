import "server-only";

import {
  catalogImagesList,
  groupsList,
  paletteColorsList,
  permissionsDefinitions,
  shopCategoriesList,
} from "@sermo/core/contracts";
import { cache } from "react";
import { call, read } from "@/lib/sermo/client";
import { ifAllowed } from "../../users/data";

// What an item's effect names, once per request: the catalog pictures and name colours (open
// reads), and the groups and permissions, which need admin.groups and admin.permissions. A read
// the viewer is refused is null: the form then takes the id typed instead, and a list shows the
// id.
export const getLookups = cache(async () => {
  const [categories, frames, covers, colours, groups, permissions] =
    await Promise.all([
      read(shopCategoriesList, {}),
      call(catalogImagesList, { kind: "frame" }),
      call(catalogImagesList, { kind: "thread_cover" }),
      call(paletteColorsList, { kind: "name" }),
      ifAllowed(() => call(groupsList, {})),
      ifAllowed(() => call(permissionsDefinitions, {})),
    ]);
  return {
    categories: categories.items,
    frames: frames.items,
    covers: covers.items,
    colours: colours.items,
    groups: groups?.items ?? null,
    permissions: permissions?.items ?? null,
  };
});

export type Lookups = Awaited<ReturnType<typeof getLookups>>;
