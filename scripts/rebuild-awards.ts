import { existsSync } from "node:fs";
import { closeContext, createContext } from "@sermo/core";
import { readConfiguration } from "../packages/api/src/server";
import { formatSummary, parseArgs, rebuildAwards, stopRun } from "./rebuild-awards-lib";

// Rebuilds levels and awards, as the button on /admin/awards does: sets every member's award XP,
// award count and per-award counters to what their grants add up to, takes back the automatic
// awards they no longer qualify for, grants those they qualify for, and notifies nobody. Hand
// grants are never touched. It makes the site match the awards' rules at that moment: a second
// run changes nothing unless rules depend on time, credits or XP, or credit rules pay for awards.
//
//   bun scripts/rebuild-awards.ts --dry-run           what a real run would change; nothing stays
//   bun scripts/rebuild-awards.ts [--admin <member id>] [--poll-ms <ms>]
//   bun scripts/rebuild-awards.ts --stop              end the run under way before its next chunk
//
// With the server's environment (inside the backend container). The server's job worker runs the
// chunks; this starts the run (or resumes one that stopped, or follows one under way), prints its
// progress and ends with a summary. Run it again to continue after an interruption or a stop.

try {
  const options = parseArgs(process.argv.slice(2));
  const config = readConfiguration();
  if (!existsSync(config.path)) throw new Error(`Database does not exist: ${config.path}`);
  const ctx = createContext({ path: config.path });
  try {
    if (options.stop) console.log(stopRun(ctx) ? "Stop requested." : "No run is under way.");
    else {
      const summary = await rebuildAwards(ctx, options, {
        sleep: (ms) => Bun.sleep(ms),
        log: (line) => console.log(line),
      });
      console.log(
        `${summary.dryRun ? "Preview (nothing was changed)" : "Done"}\n${formatSummary(summary)}`,
      );
    }
  } finally {
    closeContext(ctx);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
