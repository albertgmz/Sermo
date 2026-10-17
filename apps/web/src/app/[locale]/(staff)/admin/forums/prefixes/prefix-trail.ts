import "server-only";

import { staffTrail } from "../../../trail";

// The way up of a prefix's page. The prefix screens sit beside the tree in the section, not under
// it, though their addresses start with the tree's.
export async function prefixTrail(path: string) {
  return (await staffTrail(path)).filter(
    ({ href }) => href !== "/admin/forums",
  );
}
