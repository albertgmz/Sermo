import {
  type Ctx,
  rebuildAdministrator,
  rebuildRunValue,
  startRebuild,
  stopRebuild,
  writeTx,
} from "@sermo/core";

// The parts of `rebuild-awards.ts` that the test drives: starting or joining the run, and
// following it until it ends. The chunks themselves are run by the server's job worker.

export interface Options {
  /** The administrator the run is logged under; by default the first who may manage awards. */
  admin?: number;
  /** Count what a real run would change, writing nothing that stays. */
  dryRun: boolean;
  /** Ask the run under way to stop, and nothing else. */
  stop: boolean;
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
  const options: Options = { dryRun: false, stop: false, pollMs: 2000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const next = argv[++i];
      if (!next) throw new Error(`${arg} needs a value.`);
      return next;
    };
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--stop") options.stop = true;
    else if (arg === "--admin") {
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
  const lines = [
    `Members processed: ${run.members}`,
    `Members whose XP or award counters were corrected: ${run.xpCorrected}`,
    `Members whose XP ${run.dryRun ? "would change" : "changed"}: ${run.xpChanged}`,
    `Levels ${run.dryRun ? "that would go up" : "that went up"}: ${run.levelsUp}`,
    `Levels ${run.dryRun ? "that would go down" : "that went down"}: ${run.levelsDown}`,
    `Awards ${run.dryRun ? "that would be granted" : "granted"}: ${run.granted}`,
    `Awards ${run.dryRun ? "that would be taken back" : "taken back"}: ${run.takenBack}`,
    `Credits ${run.dryRun ? "that would be paid" : "paid"}: ${run.creditsPaid}`,
    `Credits ${run.dryRun ? "that would be taken back" : "taken back"}: ${run.creditsRemoved}`,
    `Members ${run.dryRun ? "who would end" : "who ended"} with a negative balance they did not have: ${run.newlyNegative}`,
  ];
  if (run.dryRun)
    lines.push("Not included: credits that credit rules paying for awards move after a real run.");
  if (run.awards.length > 0) {
    lines.push("By award (most affected first, up to 20): granted / taken back");
    for (const award of run.awards)
      lines.push(`  ${award.name}: ${award.granted} / ${award.takenBack}`);
  }
  return lines.join("\n");
}

/**
 * Starts the run of the web app's "Rebuild levels and awards" (or resumes one that stopped on an
 * error, or joins one under way), then follows it. Returns the final state; throws when the run
 * fails, in which case calling it again resumes from the member it stopped at.
 */
export function stopRun(ctx: Ctx): boolean {
  return writeTx(ctx, () => stopRebuild(ctx));
}

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
  const queued = writeTx(ctx, () => startRebuild(ctx, admin, options.dryRun));
  log(queued ? "Run started." : "A run is already under way; following it.");
  if (!queued && rebuildRunValue(ctx).dryRun !== options.dryRun)
    throw new Error(
      options.dryRun
        ? "A real rebuild is under way: --dry-run would not preview it. Follow it without --dry-run, or stop it with --stop."
        : "A preview is under way: wait for it, or stop it with --stop, then run again.",
    );
  let shown = "";
  let still = 0;
  for (;;) {
    const run = rebuildRunValue(ctx);
    if (run.state === "failed") throw new Error(`The run stopped: ${run.error}`);
    if (run.state === "stopped")
      throw new Error("The run was stopped. Run the command again to resume it.");
    if (run.state === "done") return run;
    const line = `${Math.floor(run.progress * 100)}%, ${run.members} members, ${run.granted} ${options.dryRun ? "to grant" : "granted"}, ${run.takenBack} ${options.dryRun ? "to take back" : "taken back"}`;
    still = line === shown ? still + 1 : 0;
    if (line !== shown) log(line);
    else if (still % STALLED_POLLS === 0)
      log("No progress: the backend's job worker runs the chunks, is the backend running?");
    shown = line;
    await sleep(options.pollMs);
  }
}
