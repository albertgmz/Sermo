import { readdirSync } from "node:fs";
import { join } from "node:path";

export const MESSAGES = join(import.meta.dir, "..", "messages");

// Every language directory under messages/: the cross-cutting suites scan all of them.
export const LOCALE_DIRS = readdirSync(MESSAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
