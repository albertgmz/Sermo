import "server-only";

import { staffTrail } from "../../../trail";

// The way up of a navigation page. The navigation screens sit beside the general settings in the
// section, not under them, though their addresses start with `/admin/settings`.
export async function navigationTrail(path: string) {
  return (await staffTrail(path)).filter(
    ({ href }) => href !== "/admin/settings",
  );
}
