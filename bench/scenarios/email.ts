import { CaptureMailer, enqueueJob, registerEmailJobs, runDueJobs } from "@sermo/core";
import { renderEmail } from "../../packages/core/src/mail/template";
import { signUnsubscribe } from "../../packages/core/src/modules/email/token";
import type { BenchEnv, Scenario } from "../harness";

const registry = {
  defaults: { "digest.weekly": { inApp: false, email: true, push: false } },
  securityTypes: new Set<string>(),
};
const DAY_MS = 86_400_000;
let token = "";
let digest: Promise<number> | null = null;
let digestStartedAt = 0;
let digests = 0;
let longestBlock = 0;
let probing = false;
let recentThreads: { id: number; last_post_at: number }[] = [];

async function measureComponents(): Promise<void> {
  const capture = new CaptureMailer();
  const renderTimes: number[] = [];
  const captureTimes: number[] = [];
  for (let i = 0; i < 100; i++) {
    const startRender = performance.now();
    const rendered = await renderEmail({
      language: "en",
      site: "Sermo",
      subject: "New activity",
      body: "A member replied to your thread.",
    });
    renderTimes.push(performance.now() - startRender);
    const startSend = performance.now();
    await capture.send({ to: "test@example.test", from: "forum@example.test", ...rendered });
    captureTimes.push(performance.now() - startSend);
  }
  renderTimes.sort((a, b) => a - b);
  captureTimes.sort((a, b) => a - b);
  console.info(
    `email component timings (exempt): render p95=${renderTimes[94]!.toFixed(2)}ms, capture p95=${captureTimes[94]!.toFixed(2)}ms`,
  );
}

/**
 * Prepares a realistic weekly digest on the scratch database: every 20th visible thread (about
 * 2,500, across every forum) becomes active within the last week, so the digest reads its full
 * 2,000 candidates; every 10th member (about 6,000, with about 1,300 distinct permission
 * combinations) is due a digest, and the rest are marked as already served this week. Teardown
 * restores the thread times and the seed's empty digest history.
 */
function prepareDigest(env: BenchEnv): void {
  const now = env.ctx.now();
  recentThreads = env.ctx.sqlite
    .prepare<{ id: number; last_post_at: number }, []>(
      "SELECT id, last_post_at FROM threads WHERE state = 'visible' AND id % 20 = 0",
    )
    .all();
  const touch = env.ctx.sqlite.prepare("UPDATE threads SET last_post_at = ?1 WHERE id = ?2");
  env.ctx.sqlite.transaction(() => {
    for (const thread of recentThreads)
      touch.run(now - ((thread.id * 7919) % (6 * DAY_MS)), thread.id);
    env.ctx.sqlite
      .prepare("UPDATE users SET last_digest_at = CASE WHEN id % 10 <> 0 THEN ?1 END")
      .run(now);
  })();
}

function restoreDigest(env: BenchEnv): void {
  const touch = env.ctx.sqlite.prepare("UPDATE threads SET last_post_at = ?1 WHERE id = ?2");
  env.ctx.sqlite.transaction(() => {
    for (const thread of recentThreads) touch.run(thread.last_post_at, thread.id);
    env.ctx.sqlite.exec("UPDATE users SET last_digest_at = NULL");
  })();
  recentThreads = [];
}

/** Longest gap between timer callbacks while the digest runs: how long it blocks the event loop. */
function probeEventLoop(): void {
  probing = true;
  longestBlock = 0;
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    longestBlock = Math.max(longestBlock, now - last);
    last = now;
    if (probing) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
}

export const scenarios: Scenario[] = [
  {
    name: "email.unsubscribe signed guest write",
    kind: "write",
    async setup(env) {
      registerEmailJobs(env.ctx, { driver: "capture", sender: "forum@example.test" }, registry);
      token = await signUnsubscribe(env.ctx, env.meta.memberIds[0]!, "digest.weekly");
      await measureComponents();
    },
    run: (env) => env.call("notifications.unsubscribe", env.actors.guest, { token }),
  },
  {
    name: "email.read while weekly digest runs",
    kind: "read",
    // With the write scenario below, enough requests to overlap most of the digest run.
    iterations: 12000,
    setup(env) {
      const capture = registerEmailJobs(
        env.ctx,
        { driver: "capture", sender: "forum@example.test" },
        registry,
      )!;
      // Hand each message off like a transport would instead of keeping thousands in memory.
      capture.send = async (message) => {
        digests++;
        return { messageId: message.messageId ?? `<digest-${digests}@sermo.local>` };
      };
      prepareDigest(env);
      enqueueJob(env.ctx, "email.digest.sweep", {}, { uniqueKey: "email.digest.sweep" });
      probeEventLoop();
      digestStartedAt = performance.now();
      digest = (async () => {
        let jobs = 0;
        while (await runDueJobs(env.ctx, { limit: 1 })) {
          jobs++;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        return jobs;
      })();
    },
    run: (env) => env.call("settings.get", env.actors.admin, {}),
  },
  {
    name: "email.write while weekly digest runs",
    kind: "write",
    iterations: 6000,
    run: (env) =>
      env.call("threads.markRead", env.actors.member(0), {
        threadId: env.meta.bigThreadIds[0]!,
        position: 0,
      }),
    async teardown(env) {
      const overlap = performance.now() - digestStartedAt;
      const jobs = await digest;
      probing = false;
      const failed = env.ctx.sqlite
        .prepare<{ n: number }, []>("SELECT count(*) AS n FROM email_failures")
        .get()!.n;
      console.info(
        `email weekly digest (exempt): jobs=${jobs}, digests=${digests}, failures=${failed}, elapsed=${(performance.now() - digestStartedAt).toFixed(0)}ms, measured requests overlapped the first ${overlap.toFixed(0)}ms, longest event-loop block=${longestBlock.toFixed(1)}ms`,
      );
      digest = null;
      digests = 0;
      restoreDigest(env);
    },
  },
];
