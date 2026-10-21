import { readFileSync } from "node:fs";
import {
  credentialsFrom,
  formatSummary,
  grantManualAwards,
  parseArgs,
  parseHolders,
} from "./grant-manual-awards-lib";

// Grants the awards that XenForo's trophies had by hand (Género Diverso, Maestro de la Integración,
// Fiesta de Cumpleaños, Defensor de la Seguridad) to the members who held them.
//
//   SERMO_API_KEY=<an administrator's API key> bun run awards:grant-manual --dry-run
//   SERMO_API_KEY=<...> bun run awards:grant-manual
//
// The credential is an API key (SERMO_API_KEY) or a signed-in session cookie
// (SERMO_SESSION_COOKIE, the whole `name=value` pair). Options: --dry-run (reads only, lists what
// would be granted), --rate <n> (writes a second, at most 3, default 3), --url <site> (default
// https://fcuba.net), --holders <file> (default scripts/manual-award-holders.json). A member who
// already holds the award is skipped, so the script can be run again.

try {
  const options = parseArgs(process.argv.slice(2));
  const holders = parseHolders(readFileSync(options.holdersFile, "utf8"));
  const summaries = await grantManualAwards(options, credentialsFrom(process.env), holders, {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => Bun.sleep(ms),
    log: (line) => console.log(line),
  });
  console.log(
    `${options.dryRun ? "Dry run (nothing written)" : "Done"}\n${formatSummary(summaries, options.dryRun)}`,
  );
  if (summaries.some((s) => s.failed > 0)) process.exit(1);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
