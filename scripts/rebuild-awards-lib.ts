import {
  type Ctx,
  rebuildAdministrator,
  rebuildRunValue,
  startRebuild,
  writeTx,
} from "@sermo/core";

// The parts of `rebuild-awards.ts` that the test drives: starting or joining the run, and
// following it until it ends. The chunks themselves are run by the server's job worker.

export interface Options {
  /** The administrator the run is logged under; by default the first who may manage awards. */
  admin?: number;
  /** How long to wait between looks at the run. */
  pollMs: number;
}

export interface Dependencies {
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export type Summary = ReturnType<typeof rebuildRunValue>;

const STALLED_POLLS = 30;

export function parseArgs(argv: string[]): Options {
  const options: Options = { pollMs: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const next = argv[++i];
      if (!next) throw new Error(`${arg} needs a value.`);
      return next;
    };
    if (arg === "--admin") {
      const id = Number(value());
      if (!Number.isSafeInteger(id) || id < 1) throw new Error("--admin takes a member id.");
      options.admin = id;
    } else if (arg === "--poll-ms") {
      const ms = Number(value());
      if (!Number.isSafeInteger(ms) || ms < 1) throw new Error("--poll-ms takes milliseconds.");
      options.pollMs = ms;
    } else throw new Error(`Unknown option ${arg}.`);
  }
  return options;
}

export function formatSummary(run: Summary): string {
  return [
    `Members processed: ${run.members}`,
    `Members whose XP or award count was corrected: ${run.xpCorrected}`,
    `Levels changed: ${run.levelsChanged}`,
    `Awards granted: ${run.granted}`,
    `Awards taken back: ${run.takenBack}`,
  ].join("\n");
}

/**
 * Starts the run of the web app's "Rebuild levels and awards" (or resumes one that stopped on an
 * error, or joins one under way), then follows it. Returns the final state; throws when the run
 * fails, in which case calling it again resumes from the member it stopped at.
 */
export async function rebuildAwards(
  ctx: Ctx,
  options: Options,
  { sleep, log }: Dependencies,
): Promise<Summary> {
  const admin = rebuildAdministrator(ctx, options.admin);
  if (admin === null)
    throw new Error(
      options.admin === undefined
        ? "No member may manage awards."
        : `Member ${options.admin} may not manage awards.`,
    );
  const queued = writeTx(ctx, () => startRebuild(ctx, admin));
  log(queued ? "Run started." : "A run is already under way; following it.");
  let shown = "";
  let still = 0;
  for (;;) {
    const run = rebuildRunValue(ctx);
    if (run.state === "failed") throw new Error(`The run stopped: ${run.error}`);
    if (run.state === "done") return run;
    const line = `${Math.floor(run.progress * 100)}%, ${run.members} members, ${run.granted} granted, ${run.takenBack} taken back`;
    still = line === shown ? still + 1 : 0;
    if (line !== shown) log(line);
    else if (still % STALLED_POLLS === 0)
      log("No progress: the backend's job worker runs the chunks, is the backend running?");
    shown = line;
    await sleep(options.pollMs);
  }
}
