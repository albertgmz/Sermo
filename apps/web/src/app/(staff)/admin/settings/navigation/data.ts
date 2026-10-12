import "server-only";

import { navigationList, permissionsDefinitions } from "@sermo/core/contracts";
import { cache } from "react";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

// The global permissions an audience can be tied to, or null when the viewer may not list the
// permissions (that needs `admin.permissions`): the editor then takes the permission as typed.
export const globalPermissions = cache(async (): Promise<string[] | null> => {
  try {
    const { items } = await call(permissionsDefinitions, {});
    return items
      .filter((item) => item.scope === "global")
      .map((item) => item.id);
  } catch (error) {
    if (error instanceof SermoError && error.code === "forbidden") return null;
    throw error;
  }
});

export const getEntries = cache(
  async () => (await read(navigationList, {})).items,
);
