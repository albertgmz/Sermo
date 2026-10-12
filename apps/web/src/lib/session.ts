import "server-only";

import { cache } from "react";
import { getUser, type UserView } from "@/lib/db";
import { getViewer } from "@/lib/sermo/session";

// Pages that still read the JSON data see the JSON member whose username is the signed-in
// account's. This file goes away with lib/db.ts.
export const getCurrentUser = cache(async (): Promise<UserView | null> => {
  const { user } = await getViewer();
  return user ? ((await getUser(user.username)) ?? null) : null;
});
