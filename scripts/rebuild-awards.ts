import { existsSync } from "node:fs";
import { closeContext, createContext } from "@sermo/core";
import { readConfiguration } from "../packages/api/src/server";
import { formatSummary, parseArgs, rebuildAwards } from "./rebuild-awards-lib";

// Rebuilds levels and awards, as the button on /admin/awards does: sets every member's award XP
// and count to what their grants add up to, takes back the automatic awards they no longer
// qualify for, grants those they qualify for, and notifies nobody. Hand grants are never touched.
//
//   bun scripts/rebuild-awards.ts [--admin <member id>] [--poll-ms <ms>]
//
// With the server's environment (inside the backend container). The server's job worker runs the
// chunks; this starts the run (or resumes one that stopped, or follows one under way), prints its
// progress and ends with a summary. Run it again to continue after an interruption; run again
// after it finished, it changes nothing.

try {
  const options = parseArgs(process.argv.slice(2));
  const config = readConfiguration();
  if (!existsSync(config.path)) throw new Error(`Database does not exist: ${config.path}`);
  const ctx = createContext({ path: config.path });
  try {
    const summary = await rebuildAwards(ctx, options, {
      sleep: (ms) => Bun.sleep(ms),
      log: (line) => console.log(line),
    });
    console.log(`Done\n${formatSummary(summary)}`);
  } finally {
    closeContext(ctx);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
