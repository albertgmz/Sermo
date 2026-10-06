import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { notificationsUnsubscribe } from "../../contracts/notifications";
import { writeTx } from "../../db/tx";
import { ValidationError } from "../../errors";
import { languageFor, phrase, phraseOr } from "../../i18n";
import type { MailConfig, Mailer } from "../../mail";
import { CaptureMailer, noneMailer, smtpMailer } from "../../mail";
import { renderEmail } from "../../mail/template";
import { implement } from "../../operation";
import {
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  viewableNodeIds,
} from "../../permissions";
import { renderPlainText } from "../../render";
import { enqueueJob, MAX_ATTEMPTS, registerJobHandler } from "../jobs/queue";
import { readSiteSettings } from "../settings";
import { signUnsubscribe, verifyUnsubscribe } from "./token";
import { visibleTo } from "./visibility";

export interface EmailItem {
  notificationId: number;
  userId: number;
  type: string;
  contentType: string;
  contentId: number;
  threadId: number | null;
  actorId: number | null;
  data: Record<string, unknown>;
}

export type ChannelDefaults = Record<string, { inApp: boolean; email: boolean; push: boolean }>;
export interface EmailRegistry {
  defaults: ChannelDefaults;
  securityTypes: ReadonlySet<string>;
  watchTypes?: ReadonlySet<string>;
}

type Recipient = PrincipalRow & {
  id: number;
  group_id: number;
  email: string;
  language: string | null;
  email_window_start: number;
  email_window_count: number;
};
type Notification = {
  id: number;
  user_id: number;
  type: string;
  content_type: string;
  content_id: number;
  thread_id: number | null;
  actor_id: number | null;
  data: string;
  read_at: number | null;
  epoch: number;
  notification_epoch: number;
  email_sent_at: number | null;
};
type Thread = { id: number; title: string; node_id: number; state: string; reply_count: number };
type DigestCandidate = Thread & { last_post_at: number };
type DigestRecipient = Recipient & {
  last_activity_at: number | null;
  last_digest_at: number | null;
};
type Settings = ReturnType<typeof readSiteSettings>;
type MailState = { mailer: Mailer; config: MailConfig; registry: EmailRegistry };
/**
 * One digest run's candidate threads and, per permission combination, the candidate nodes it
 * may view. Kept in memory for the run; a process that picks up a run without it rebuilds it.
 * Messages re-check each chosen thread, so a permission change during the run cannot leak.
 */
type DigestRun = {
  startedAt: number;
  candidates: DigestCandidate[];
  candidateNodes: ReadonlySet<number>;
  visibleNodes: Map<number, ReadonlySet<number>>;
};

const DAY_MS = 86_400_000;
const DIGEST_BATCH_SIZE = 25;
/** Members claimed at a time within a batch, so a time box rarely strands claimed members. */
const DIGEST_CLAIM_SIZE = 5;
/** Longest a digest batch keeps sending before it hands over to a queued continuation. */
const DIGEST_BATCH_MS = 250;
/** Delay before a digest continuation retries after a connection or authentication failure. */
const DIGEST_RETRY_MS = 30_000;

const state = new WeakMap<Ctx, MailState>();
const registeredTypes = new WeakMap<Ctx, EmailRegistry>();
/** Per context, the caches of the two most recent runs, keyed by run start time. */
const digestRuns = new WeakMap<Ctx, Map<number, DigestRun>>();

export function registerEmailTypes(ctx: Ctx, registry: EmailRegistry): void {
  registeredTypes.set(ctx, registry);
}

function activeRegistry(ctx: Ctx, current: MailState): EmailRegistry {
  const registered = registeredTypes.get(ctx);
  if (!registered) return current.registry;
  return {
    defaults: { ...current.registry.defaults, ...registered.defaults },
    securityTypes: new Set([...current.registry.securityTypes, ...registered.securityTypes]),
    watchTypes: new Set([...(current.registry.watchTypes ?? []), ...(registered.watchTypes ?? [])]),
  };
}

function recipient(ctx: Ctx, userId: number): Recipient | null {
  return (
    prepared(ctx, "email.recipient", () =>
      ctx.sqlite.prepare<Recipient, [number]>(
        `SELECT u.id, u.group_id, u.language, u.email_window_start, u.email_window_count, a.email, ${PRINCIPAL_COLUMNS} FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1`,
      ),
    ).get(userId) ?? null
  );
}

function notification(ctx: Ctx, id: number): Notification | null {
  return (
    prepared(ctx, "email.notification", () =>
      ctx.sqlite.prepare<Notification, [number]>(
        "SELECT n.id, n.user_id, n.type, n.content_type, n.content_id, n.thread_id, n.actor_id, n.data, n.read_at, n.epoch, n.email_sent_at, u.notification_epoch FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = ?1",
      ),
    ).get(id) ?? null
  );
}

function thread(ctx: Ctx, id: number): Thread | null {
  return (
    prepared(ctx, "email.thread", () =>
      ctx.sqlite.prepare<Thread, [number]>(
        "SELECT id, title, node_id, state, reply_count FROM threads WHERE id = ?1",
      ),
    ).get(id) ?? null
  );
}

export const emailSql = {
  preferences:
    "SELECT user_id, type, email FROM notification_preferences WHERE user_id IN (SELECT value FROM json_each(?1)) AND type IN (SELECT value FROM json_each(?2))",
  watches:
    "SELECT t.id AS thread_id, json_extract(j.value, '$[1]') AS user_id, CASE WHEN tw.user_id IS NOT NULL THEN tw.email ELSE nw.email END AS email FROM json_each(?1) j JOIN threads t ON t.id = json_extract(j.value, '$[0]') LEFT JOIN thread_watches tw ON tw.thread_id = t.id AND tw.user_id = json_extract(j.value, '$[1]') LEFT JOIN node_watches nw ON nw.node_id = t.node_id AND nw.user_id = json_extract(j.value, '$[1]')",
  undeliverableBatch:
    "SELECT email FROM undeliverable_emails WHERE email IN (SELECT value FROM json_each(?1))",
  sent: "SELECT id FROM notifications WHERE id IN (SELECT value FROM json_each(?1)) AND email_sent_at IS NOT NULL",
  digestCandidates:
    "SELECT id, title, node_id, state, reply_count, last_post_at FROM threads WHERE state = 'visible' AND last_post_at >= ?1 ORDER BY last_post_at DESC, id DESC LIMIT 2000",
};

/** Stored email preferences of each (member, type) pair, keyed `${userId}:${type}`. */
function emailPreferences(
  ctx: Ctx,
  items: readonly { userId: number; type: string }[],
): Map<string, number | null> {
  const rows = prepared(ctx, "email.preferences", () =>
    ctx.sqlite.prepare<{ user_id: number; type: string; email: number | null }, [string, string]>(
      emailSql.preferences,
    ),
  ).all(
    JSON.stringify([...new Set(items.map((item) => item.userId))]),
    JSON.stringify([...new Set(items.map((item) => item.type))]),
  );
  return new Map(rows.map((row) => [`${row.user_id}:${row.type}`, row.email]));
}

function enabled(
  registry: EmailRegistry,
  settings: Settings,
  preferences: Map<string, number | null>,
  userId: number,
  type: string,
): boolean {
  if (isSecurity(registry, type)) return true;
  return Boolean(
    preferences.get(`${userId}:${type}`) ??
      settings.notificationDefaults[type]?.email ??
      registry.defaults[type]?.email,
  );
}

function isSecurity(registry: EmailRegistry, type: string): boolean {
  return registry.securityTypes.has(type) || type.startsWith("security.");
}

function isWatchType(registry: EmailRegistry, type: string): boolean {
  return registry.watchTypes?.has(type) ?? type.startsWith("watch.");
}

/**
 * The (thread, member) pairs, keyed `${threadId}:${userId}`, whose watch asks for email: the
 * thread watch when there is one, otherwise the watch on the thread's node.
 */
function emailWatches(
  ctx: Ctx,
  pairs: readonly { threadId: number; userId: number }[],
): Set<string> {
  if (!pairs.length) return new Set();
  const rows = prepared(ctx, "email.watches", () =>
    ctx.sqlite.prepare<{ thread_id: number; user_id: number; email: number | null }, [string]>(
      emailSql.watches,
    ),
  ).all(JSON.stringify(pairs.map((pair) => [pair.threadId, pair.userId])));
  return new Set(rows.filter((row) => row.email).map((row) => `${row.thread_id}:${row.user_id}`));
}

function watchAllows(
  registry: EmailRegistry,
  watches: Set<string>,
  item: { type: string; threadId: number | null; userId: number },
): boolean {
  if (!isWatchType(registry, item.type)) return true;
  return item.threadId !== null && watches.has(`${item.threadId}:${item.userId}`);
}

/**
 * Called by the notification module while its batch transaction is active. Runs a fixed number
 * of set-based reads for the whole batch, then one insert (and one cap update) per queued email.
 */
export function deliverEmail(ctx: Ctx, items: EmailItem[], registry: EmailRegistry): void {
  const current = state.get(ctx);
  if (current) current.registry = registry;
  if (current?.config.driver === "none" || !items.length) return;
  writeTx(ctx, () => {
    const settings = readSiteSettings(ctx);
    const now = ctx.now();
    const preferences = emailPreferences(ctx, items);
    const wanted = items.filter((item) =>
      enabled(registry, settings, preferences, item.userId, item.type),
    );
    if (!wanted.length) return;
    const watches = emailWatches(
      ctx,
      wanted.flatMap((item) =>
        isWatchType(registry, item.type) && item.threadId !== null
          ? [{ threadId: item.threadId, userId: item.userId }]
          : [],
      ),
    );
    const sent = new Set(
      prepared(ctx, "email.alreadySent", () =>
        ctx.sqlite.prepare<{ id: number }, [string]>(emailSql.sent),
      )
        .all(JSON.stringify(wanted.map((item) => item.notificationId)))
        .map((row) => row.id),
    );
    const claimCap = prepared(ctx, "email.claimCap", () =>
      ctx.sqlite.prepare(
        "UPDATE users SET email_window_start = CASE WHEN email_window_start <= ?1 THEN ?2 ELSE email_window_start END, email_window_count = CASE WHEN email_window_start <= ?1 THEN 1 ELSE email_window_count + 1 END WHERE id = ?3 AND (email_window_start <= ?1 OR email_window_count < ?4)",
      ),
    );
    for (const item of wanted) {
      if (sent.has(item.notificationId) || !watchAllows(registry, watches, item)) continue;
      const security = isSecurity(registry, item.type);
      if (!security && settings.emailHourlyCap === 0) continue;
      // An email already queued for this notification conflicts on the unique key.
      const jobId = enqueueJob(
        ctx,
        "email.send",
        { kind: "notification", notificationId: item.notificationId },
        { uniqueKey: `email.notification.${item.notificationId}` },
      );
      if (jobId === null || security) continue;
      if (!claimCap.run(now - 3_600_000, now, item.userId, settings.emailHourlyCap).changes)
        prepared(ctx, "email.unqueue", () =>
          ctx.sqlite.prepare("DELETE FROM jobs WHERE id = ?1"),
        ).run(jobId);
    }
  });
}

function digestKey(startedAt: number, after: number): string {
  return `email.digest.sweep.${startedAt}.${after}`;
}

function jobAttempts(ctx: Ctx, jobId: number | undefined): number {
  if (jobId === undefined) return 0;
  return (
    prepared(ctx, "email.jobAttempts", () =>
      ctx.sqlite.prepare<{ attempts: number }, [number]>("SELECT attempts FROM jobs WHERE id = ?1"),
    ).get(jobId)?.attempts ?? 0
  );
}

function digestRun(ctx: Ctx, startedAt: number, now: number): DigestRun {
  const runs = digestRuns.get(ctx) ?? new Map<number, DigestRun>();
  digestRuns.set(ctx, runs);
  let run = runs.get(startedAt);
  if (!run) {
    const candidates = prepared(ctx, "email.digestCandidates", () =>
      ctx.sqlite.prepare<DigestCandidate, [number]>(emailSql.digestCandidates),
    ).all(now - 7 * DAY_MS);
    run = {
      startedAt,
      candidates,
      candidateNodes: new Set(candidates.map((candidate) => candidate.node_id)),
      visibleNodes: new Map(),
    };
    runs.set(startedAt, run);
    // Keep at most two runs: a new run's chain and one still finishing.
    for (const key of runs.keys()) if (runs.size > 2) runs.delete(key);
  }
  return run;
}

/** Candidate nodes the member's permission combination may view, computed once per run. */
function digestNodes(ctx: Ctx, run: DigestRun, user: DigestRecipient, actor: Actor) {
  const combinationId = user.permission_combination_id || -user.id;
  let nodes = run.visibleNodes.get(combinationId);
  if (!nodes) {
    nodes = new Set(viewableNodeIds(ctx, actor).filter((id) => run.candidateNodes.has(id)));
    run.visibleNodes.set(combinationId, nodes);
  }
  return nodes;
}

function banned(user: PrincipalRow, now: number): boolean {
  return !!user.banned_permanently || (user.banned_until ?? 0) > now;
}

/**
 * Sends one bounded digest batch and queues its continuation. Digests are exempt from the hourly
 * cap (one per week by design). A failure that belongs to one member (building their message, or
 * the server permanently refusing their address or message) is recorded and the batch goes on. A
 * connection, authentication or temporary failure queues the continuation from that member so the
 * rest of the run is retried later.
 */
export async function runWeeklyDigest(
  ctx: Ctx,
  registry: EmailRegistry,
  cursor = 0,
  startedAt = ctx.now(),
  jobId?: number,
): Promise<number> {
  const mail = state.get(ctx);
  if (!mail || mail.config.driver === "none") return 0;
  const settings = readSiteSettings(ctx);
  const now = ctx.now();
  const weekBefore = now - 6 * DAY_MS;
  const run = digestRun(ctx, startedAt, now);
  const users = prepared(ctx, "email.digestUsers", () =>
    ctx.sqlite.prepare<DigestRecipient, [number, number, number, number]>(
      `SELECT u.id, u.group_id, u.language, u.email_window_start, u.email_window_count, u.last_activity_at, u.last_digest_at, a.email, ${PRINCIPAL_COLUMNS} FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id > ?1 AND (u.last_activity_at IS NULL OR u.last_activity_at <= ?2) AND (u.last_digest_at IS NULL OR u.last_digest_at <= ?3) ORDER BY u.id LIMIT ?4`,
    ),
  ).all(cursor, now - settings.digestInactiveDays * DAY_MS, weekBefore, DIGEST_BATCH_SIZE);
  const preferences = emailPreferences(
    ctx,
    users.map((user) => ({ userId: user.id, type: "digest.weekly" })),
  );
  const claim = prepared(ctx, "email.digestClaim", () =>
    ctx.sqlite.prepare(
      "UPDATE users SET last_digest_at = ?1 WHERE id = ?2 AND (last_digest_at IS NULL OR last_digest_at <= ?3) AND (last_activity_at IS NULL OR last_activity_at <= ?4)",
    ),
  );
  const previousDigest = prepared(ctx, "email.digestPrevious", () =>
    ctx.sqlite.prepare<{ last_digest_at: number | null }, [number]>(
      "SELECT last_digest_at FROM users WHERE id = ?1",
    ),
  );
  // Restores the value the claim replaced, unless something else changed it since.
  const release = prepared(ctx, "email.digestRelease", () =>
    ctx.sqlite.prepare(
      "UPDATE users SET last_digest_at = ?3 WHERE id = ?1 AND last_digest_at = ?2",
    ),
  );
  const blocked = new Set(
    prepared(ctx, "email.undeliverableBatch", () =>
      ctx.sqlite.prepare<{ email: string }, [string]>(emailSql.undeliverableBatch),
    )
      .all(JSON.stringify(users.map((user) => user.email.toLowerCase())))
      .map((row) => row.email),
  );
  // Choose each member's threads first; claim them a few at a time as the batch goes.
  const due: { user: DigestRecipient; chosen: number[]; previous: number }[] = [];
  let after = cursor;
  for (const user of users) {
    const previous = after;
    after = user.id;
    if (banned(user, now) || blocked.has(user.email.toLowerCase())) continue;
    if (!enabled(registry, settings, preferences, user.id, "digest.weekly")) continue;
    const actor = memberActor(user.id, user.group_id, user, currentVersions(ctx));
    const nodes = digestNodes(ctx, run, user, actor);
    const since = Math.max(user.last_activity_at ?? 0, user.last_digest_at ?? 0);
    const chosen: number[] = [];
    for (const candidate of run.candidates) {
      if (candidate.last_post_at <= since || chosen.length === 10) break;
      if (nodes.has(candidate.node_id)) chosen.push(candidate.id);
    }
    if (chosen.length) due.push({ user, chosen, previous });
  }
  const batchStart = performance.now();
  let sent = 0;
  let retryAt: number | null = null;
  groups: for (let start = 0; start < due.length; start += DIGEST_CLAIM_SIZE) {
    if (performance.now() - batchStart >= DIGEST_BATCH_MS) {
      after = due[start]!.previous;
      break;
    }
    const claimed = writeTx(ctx, () => {
      const inactiveBefore = now - readSiteSettings(ctx).digestInactiveDays * DAY_MS;
      return due.slice(start, start + DIGEST_CLAIM_SIZE).flatMap((entry) => {
        const lastDigestAt = previousDigest.get(entry.user.id)?.last_digest_at ?? null;
        return claim.run(now, entry.user.id, weekBefore, inactiveBefore).changes > 0
          ? [{ ...entry, lastDigestAt }]
          : [];
      });
    });
    const releaseFrom = (index: number) =>
      writeTx(ctx, () => {
        for (const entry of claimed.slice(index))
          release.run(entry.user.id, now, entry.lastDigestAt);
      });
    for (const [index, { chosen, previous, lastDigestAt, ...entry }] of claimed.entries()) {
      const releaseOne = () => writeTx(ctx, () => release.run(entry.user.id, now, lastDigestAt));
      // The member as they are now: a ban, group or address change since the batch was read counts.
      const user = recipient(ctx, entry.user.id);
      if (!user || banned(user, now) || undeliverable(ctx, user.email)) {
        releaseOne();
        continue;
      }
      const current = state.get(ctx)!;
      let message: Awaited<ReturnType<typeof digestMessage>>;
      try {
        message = await digestMessage(ctx, user, chosen, current, settings);
      } catch (error) {
        releaseOne();
        recordFailure(ctx, user.id, user.email, "digest.weekly", error, true, false);
        continue;
      }
      if (!message) {
        // Nothing chosen is visible any more: this member has had no digest this week.
        releaseOne();
        continue;
      }
      try {
        await current.mailer.send(message);
        sent++;
      } catch (error) {
        const kind = digestFailure(error);
        // A job that fails on the member right after its cursor retries that member itself. After
        // the last attempt a connection failure skips the member so the run can go on; a policy
        // refusal concerns every member, so the job fails and the run stops instead.
        const firstOfJob = previous === cursor;
        const skip =
          kind === "own" ||
          (kind === "connection" && firstOfJob && jobAttempts(ctx, jobId) >= MAX_ATTEMPTS);
        if (skip) releaseOne();
        else releaseFrom(index);
        recordFailure(
          ctx,
          user.id,
          user.email,
          "digest.weekly",
          error,
          skip,
          kind === "own" && mailboxRejected(error),
        );
        if (skip) continue;
        if (firstOfJob) throw error;
        // Queue the continuation from this member instead of failing the job: a retry of this job
        // and the continuation would otherwise both walk the rest of the run.
        after = previous;
        retryAt = ctx.now() + DIGEST_RETRY_MS;
        break groups;
      }
    }
  }
  if (retryAt !== null || users.length === DIGEST_BATCH_SIZE || after < (users.at(-1)?.id ?? 0)) {
    enqueueJob(
      ctx,
      "email.digest.sweep",
      { after, startedAt },
      { uniqueKey: digestKey(startedAt, after), runAt: retryAt ?? ctx.now() },
    );
  } else {
    digestRuns.get(ctx)?.delete(startedAt);
  }
  return sent;
}

async function notificationMessage(
  ctx: Ctx,
  row: Notification,
  user: Recipient,
  current: MailState,
) {
  const actor = memberActor(user.id, user.group_id, user, currentVersions(ctx));
  const registry = activeRegistry(ctx, current);
  const security = isSecurity(registry, row.type);
  if (!security && (row.read_at !== null || row.epoch !== row.notification_epoch)) return null;
  const settings = readSiteSettings(ctx);
  const item = { userId: row.user_id, type: row.type, threadId: row.thread_id };
  if (!enabled(registry, settings, emailPreferences(ctx, [item]), user.id, row.type)) return null;
  const watches = emailWatches(
    ctx,
    isWatchType(registry, row.type) && row.thread_id !== null
      ? [{ threadId: row.thread_id, userId: row.user_id }]
      : [],
  );
  if (!watchAllows(registry, watches, item)) return null;
  if (
    !(security && row.content_type === "security") &&
    !visibleTo(ctx, actor, row.content_type, row.content_id, row.thread_id)
  )
    return null;
  if (undeliverable(ctx, user.email)) return null;
  const language = languageFor(user.language, settings.defaultLanguage);
  const site = settings.siteName;
  const siteUrl = ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000";
  const t = row.thread_id === null ? null : thread(ctx, row.thread_id);
  const contentTitle = t?.title ?? "";
  let body = phraseOr(
    language,
    `notification.${row.type}.body`,
    contentTitle || phrase(language, "email.notification.body"),
    { title: contentTitle },
  );
  if (row.content_type === "conversation_message") {
    body = phrase(language, "email.conversation.body");
    if (settings.conversationEmailIncludesBody) {
      const message = prepared(ctx, "email.conversationBody", () =>
        ctx.sqlite.prepare<{ body_html: string }, [number]>(
          "SELECT body_html FROM conversation_messages WHERE id = ?1 AND state = 'visible'",
        ),
      ).get(row.content_id);
      if (message) body += `\n\n${renderPlainText(message.body_html)}`;
    }
  }
  const unsubscribe = security
    ? undefined
    : {
        typeUrl: `${siteUrl}/api/v1/unsubscribe?token=${encodeURIComponent(await signUnsubscribe(ctx, user.id, row.type))}`,
        allUrl: `${siteUrl}/api/v1/unsubscribe?token=${encodeURIComponent(await signUnsubscribe(ctx, user.id, "all"))}`,
      };
  const rendered = await renderEmail({
    language,
    site,
    subject: phraseOr(
      language,
      `notification.${row.type}.title`,
      phrase(language, "email.notification.subject", { site }),
      { site, title: contentTitle },
    ),
    body,
    ...(unsubscribe ? { unsubscribe } : {}),
  });
  const domain = new URL(siteUrl).hostname;
  const messageId = t ? `<thread-${t.id}-notification-${row.id}@${domain}>` : undefined;
  const rootId = t ? `<thread-${t.id}@${domain}>` : undefined;
  return {
    to: user.email,
    from: current.config.sender,
    ...(current.config.replyTo ? { replyTo: current.config.replyTo } : {}),
    ...rendered,
    ...(messageId ? { messageId, inReplyTo: rootId, references: rootId } : {}),
    ...(unsubscribe
      ? {
          headers: {
            "List-Unsubscribe": `<${unsubscribe.typeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }
      : {}),
  };
}

function undeliverable(ctx: Ctx, email: string): boolean {
  return !!prepared(ctx, "email.undeliverable", () =>
    ctx.sqlite.prepare<{ id: number }, [string]>(
      "SELECT id FROM undeliverable_emails WHERE email = ?1",
    ),
  ).get(email.toLowerCase());
}

async function digestMessage(
  ctx: Ctx,
  user: Recipient,
  threadIds: number[],
  current: MailState,
  settings: Settings,
) {
  const actor = memberActor(user.id, user.group_id, user, currentVersions(ctx));
  const language = languageFor(user.language, settings.defaultLanguage);
  const siteUrl = ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000";
  const selected = threadIds
    .map((id) => thread(ctx, id))
    .filter(
      (item): item is Thread =>
        item?.state === "visible" && visibleTo(ctx, actor, "thread", item.id, null),
    )
    .slice(0, 10);
  if (!selected.length) return null;
  const unsubscribe = {
    typeUrl: `${siteUrl}/api/v1/unsubscribe?token=${encodeURIComponent(await signUnsubscribe(ctx, user.id, "digest.weekly"))}`,
    allUrl: `${siteUrl}/api/v1/unsubscribe?token=${encodeURIComponent(await signUnsubscribe(ctx, user.id, "all"))}`,
  };
  const rendered = await renderEmail({
    language,
    site: settings.siteName,
    subject: phrase(language, "email.digest.subject", { site: settings.siteName }),
    body: phrase(language, "email.digest.body", { count: selected.length }),
    links: selected.map((item) => ({
      label: phrase(language, "email.digest.thread", {
        title: item.title,
        replies: item.reply_count,
      }),
      url: `${siteUrl}/threads/${item.id}`,
    })),
    unsubscribe,
  });
  return {
    to: user.email,
    from: current.config.sender,
    ...(current.config.replyTo ? { replyTo: current.config.replyTo } : {}),
    ...rendered,
    headers: {
      "List-Unsubscribe": `<${unsubscribe.typeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

function recordFailure(
  ctx: Ctx,
  userId: number,
  email: string,
  template: string,
  error: unknown,
  permanent: boolean,
  undeliverable: boolean,
) {
  const message = error instanceof Error ? error.message : String(error);
  writeTx(ctx, () => {
    prepared(ctx, "email.failure", () =>
      ctx.sqlite.prepare(
        "INSERT INTO email_failures (user_id, email, template, error, permanent, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      ),
    ).run(
      userId,
      email.toLowerCase(),
      template,
      message.slice(0, 1000),
      permanent ? 1 : 0,
      ctx.now(),
    );
    if (undeliverable)
      prepared(ctx, "email.undeliverableInsert", () =>
        ctx.sqlite.prepare(
          "INSERT INTO undeliverable_emails (email, reason, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (email) DO NOTHING",
        ),
      ).run(email.toLowerCase(), message.slice(0, 1000), ctx.now());
  });
}

/** Nodemailer codes of connection, TLS, protocol and authentication failures. */
const TRANSPORT_CODES = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EDNS",
  "ETLS",
  "EREQUIRETLS",
  "EPROTOCOL",
  "EAUTH",
  "ENOAUTH",
  "EOAUTH2",
  "EMAXLIMIT",
  "EPROXY",
]);

/**
 * The failure is not about one recipient: the connection or authentication failed, the sender
 * was refused, or the server asked to try again later (any 4xx reply, such as rate limiting).
 */
function transportFailure(error: unknown): boolean {
  const details = error as { code?: unknown; command?: unknown; responseCode?: unknown } | null;
  const code = Number(details?.responseCode);
  const command = String(details?.command ?? "");
  return (
    TRANSPORT_CODES.has(String(details?.code)) ||
    (code >= 400 && code < 500) ||
    (command === "MAIL FROM" && details?.code === "EENVELOPE") ||
    command.startsWith("AUTH")
  );
}

/**
 * How a failed digest send is handled:
 * - "connection": connection, authentication, sender or temporary failures; retried later.
 * - "policy": the server refuses mail from this sender (DMARC, an unverified sender, relaying):
 *   any 5.7.x at RCPT TO or DATA, or a DATA refusal without a mailbox status (5.1.x, 5.2.x). It
 *   concerns every member, so it is retried later like a connection failure, never per member.
 * - "own": this member's address or message was refused (5.1.x, 5.2.x, or a bare 5xx at RCPT
 *   TO), or anything else that is not a transport error; recorded and skipped.
 */
function digestFailure(error: unknown): "connection" | "policy" | "own" {
  if (transportFailure(error)) return "connection";
  const details = error as { command?: unknown; responseCode?: unknown; response?: unknown } | null;
  const command = details?.command;
  if ((command !== "RCPT TO" && command !== "DATA") || Number(details?.responseCode) < 500)
    return "own";
  const enhanced = enhancedStatus(String(details?.response ?? ""));
  if (enhanced?.startsWith("5.7.")) return "policy";
  if (enhanced?.startsWith("5.1.") || enhanced?.startsWith("5.2.")) return "own";
  return command === "DATA" ? "policy" : "own";
}

/** The enhanced status code (RFC 3463) that directly follows a reply code on any reply line. */
export function enhancedStatus(response: string): string | null {
  return response.match(/^\d{3}[ -](\d\.\d{1,3}\.\d{1,3})/m)?.[1] ?? null;
}

function mailboxRejected(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as { responseCode?: unknown; command?: unknown; response?: unknown };
  if (details.command !== "RCPT TO" || ![550, 551, 553].includes(Number(details.responseCode)))
    return false;
  const enhanced = enhancedStatus(String(details.response ?? ""));
  return !!enhanced && (enhanced.startsWith("5.1.") || enhanced === "5.2.1");
}

export function registerEmailJobs(
  ctx: Ctx,
  config: MailConfig,
  registry: EmailRegistry,
): CaptureMailer | null {
  const capture = config.driver === "capture" ? new CaptureMailer() : null;
  const mailer = capture ?? (config.driver === "smtp" ? smtpMailer(config) : noneMailer);
  state.get(ctx)?.mailer.close?.();
  state.set(ctx, { config, registry, mailer });
  registerJobHandler(ctx, "email.digest.sweep", async (_ctx, payload, claimed) => {
    const job = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    await runWeeklyDigest(
      ctx,
      activeRegistry(ctx, state.get(ctx)!),
      Number(job.after ?? 0),
      Number(job.startedAt ?? ctx.now()),
      claimed.id,
    );
  });
  registerJobHandler(ctx, "email.send", async (_ctx, payload, claimedJob) => {
    if (!payload || typeof payload !== "object" || !("kind" in payload))
      throw new ValidationError("Invalid email job.");
    const job = payload as Record<string, unknown>;
    const isNotification = job.kind === "notification" && Number.isSafeInteger(job.notificationId);
    if (!isNotification) throw new ValidationError("Invalid email job.");
    const row = isNotification ? notification(ctx, Number(job.notificationId)) : null;
    if (!row) return;
    const user = recipient(ctx, row.user_id);
    if (!user) return;
    const current = state.get(ctx)!;
    const types = activeRegistry(ctx, current);
    if (!(row.type in types.defaults) && !types.securityTypes.has(row.type))
      throw new ValidationError(`Email type ${row.type} is not registered.`);
    const claimTime = ctx.now();
    const claimed = writeTx(
      ctx,
      () =>
        prepared(ctx, "email.claimNotification", () =>
          ctx.sqlite.prepare(
            "UPDATE notifications SET email_sent_at = ?1 WHERE id = ?2 AND email_sent_at IS NULL",
          ),
        ).run(claimTime, row.id).changes > 0,
    );
    if (!claimed) return;
    const resetSent = prepared(ctx, "email.resetSent", () =>
      ctx.sqlite.prepare(
        "UPDATE notifications SET email_sent_at = NULL WHERE id = ?1 AND email_sent_at = ?2",
      ),
    );
    try {
      const message = await notificationMessage(ctx, row, user, current);
      if (!message) {
        writeTx(ctx, () => resetSent.run(row.id, claimTime));
        return;
      }
      await current.mailer.send(message);
    } catch (error) {
      writeTx(ctx, () => resetSent.run(row.id, claimTime));
      const rejectedAddress = mailboxRejected(error);
      recordFailure(
        ctx,
        user.id,
        user.email,
        row.type,
        error,
        rejectedAddress || jobAttempts(ctx, claimedJob.id) >= MAX_ATTEMPTS,
        rejectedAddress,
      );
      if (rejectedAddress) return;
      throw error;
    }
  });
  return capture;
}

/** Closes the mail transport (graceful shutdown). */
export function closeEmail(ctx: Ctx): void {
  state.get(ctx)?.mailer.close?.();
}

export const unsubscribeOp = implement(
  notificationsUnsubscribe,
  async (ctx, _actor, input) => {
    const claim = await verifyUnsubscribe(ctx, input.token);
    const current = state.get(ctx);
    if (!current) throw new Error("Email service is not registered.");
    const registry = activeRegistry(ctx, current);
    const types =
      claim.scope === "all"
        ? Object.keys(registry.defaults).filter((type) => !isSecurity(registry, type))
        : claim.scope in registry.defaults && !isSecurity(registry, claim.scope)
          ? [claim.scope]
          : [];
    if (!types.length) throw new ValidationError("Invalid unsubscribe scope.");
    writeTx(ctx, () => {
      if (!recipient(ctx, claim.userId)) throw new ValidationError("Invalid link.");
      const upsert = prepared(ctx, "email.unsubscribe", () =>
        ctx.sqlite.prepare(
          "INSERT INTO notification_preferences (user_id, type, email) VALUES (?1, ?2, 0) ON CONFLICT (user_id, type) DO UPDATE SET email = 0",
        ),
      );
      for (const type of types) upsert.run(claim.userId, type);
    });
    return { scope: claim.scope };
  },
  { public: "The signed HMAC token authorizes this preference change." },
);

export const operations = [unsubscribeOp];
