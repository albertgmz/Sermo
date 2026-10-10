import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import webPush from "web-push";
import { invalidate } from "../../context";
import { dispatchEvents } from "../../events";
import { phrase } from "../../i18n";
import en from "../../i18n/locales/en.json";
import es from "../../i18n/locales/es.json";
import { execute } from "../../operation";
import { deliverEmail, registerEmailJobs } from "../email";
import { postsCreateOp, threadsCreateOp } from "../forums";
import { runDueJobs } from "../jobs";
import { configurePush, pushSubscribeOp, registerPushJobs } from "../push";
import type { PushPhrase } from "../push/delivery";
import { threadsWatchOp } from "../social";
import {
  notificationChannels,
  notificationPushPhrase,
  notificationsPreferencesOp,
  notificationsSetPreferencesOp,
  notificationsTypesOp,
  registerNotificationJobs,
} from "./index";
import { notificationTypes } from "./types";

type TestCtx = ReturnType<typeof createTestContext>;
const cert = readFileSync(new URL("../push/fixtures/test-cert.pem", import.meta.url));
const key = readFileSync(new URL("../push/fixtures/test-key.pem", import.meta.url));
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

describe("notification phrases", () => {
  test("every registered type has a title and body in English and Spanish", () => {
    const catalogs: Record<string, Record<string, string>> = { en, es };
    const missing = notificationTypes.flatMap((type) =>
      Object.entries(catalogs).flatMap(([language, catalog]) =>
        [type.title, type.body].filter((key) => !catalog[key]).map((key) => `${language}:${key}`),
      ),
    );
    expect(missing).toEqual([]);
    for (const type of notificationTypes)
      for (const language of ["en", "es"] as const)
        for (const key of [type.title, type.body])
          expect(phrase(language, key, { title: "Topic", site: "Forum", count: 2 })).not.toContain(
            "{",
          );
  });

  test("grouped types pluralize on the actor count", () => {
    for (const type of notificationTypes.filter((entry) => entry.group))
      for (const language of ["en", "es"] as const) {
        const one = phrase(language, type.body, { title: "Topic", site: "Forum", count: 1 });
        const many = phrase(language, type.body, { title: "Topic", site: "Forum", count: 3 });
        expect(many).toContain("3");
        expect(one).not.toEqual(many);
      }
  });
});

/**
 * A member who watches the thread, subscribed to push at the local endpoint. `enabled` turns the
 * type's email and push preferences on or off; `watchEmail` is the watch's email flag.
 */
async function watcher(
  ctx: TestCtx,
  threadId: number,
  origin: string,
  enabled: boolean | null,
  watchEmail = true,
) {
  const user = insertUser(ctx);
  const actor = userActor(user);
  await execute(ctx, threadsWatchOp, actor, { threadId, email: watchEmail });
  await execute(ctx, pushSubscribeOp, actor, {
    endpoint: `${origin}/push/${user.id}`,
    keys: {
      p256dh: webPush.generateVAPIDKeys().publicKey,
      auth: randomBytes(16).toString("base64url"),
    },
    userAgent: "Bun test",
  });
  if (enabled !== null)
    await execute(ctx, notificationsSetPreferencesOp, actor, {
      items: [{ type: "thread.watched", email: enabled, push: enabled }],
    });
  return user;
}

async function fixture() {
  const received: string[] = [];
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    async fetch(request) {
      received.push(new URL(request.url).pathname);
      await request.arrayBuffer();
      return new Response(null, { status: 201 });
    },
  });
  const ctx = createTestContext();
  cleanup.push(() => {
    server.stop(true);
    ctx.sqlite.close(true);
  });
  const origin = `https://localhost:${server.port}`;
  registerNotificationJobs(ctx);
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    notificationChannels,
  )!;
  configurePush(ctx, {
    vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
    testAllowedEndpointOrigin: origin,
    testCa: cert,
  });
  const rendered: Array<{ userId: number; phrase: PushPhrase }> = [];
  const render = notificationPushPhrase(ctx);
  registerPushJobs(ctx, {
    renderPhrase: (item, language) => {
      const result = render(item, language);
      rendered.push({ userId: item.userId, phrase: result });
      return result;
    },
  });
  const author = insertUser(ctx);
  const replier = insertUser(ctx);
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const made = await execute(ctx, threadsCreateOp, userActor(author), {
    nodeId: node.id,
    title: "Topic",
    body: "Opening",
  });
  const threadId = made.thread.id;
  const on = await watcher(ctx, threadId, origin, true);
  const off = await watcher(ctx, threadId, origin, false);
  const unset = await watcher(ctx, threadId, origin, null);
  const quiet = await watcher(ctx, threadId, origin, null, false);
  const settle = async () => {
    await dispatchEvents(ctx);
    while (await runDueJobs(ctx)) await dispatchEvents(ctx);
  };
  await settle();
  const reply = async (user: { id: number; groupId: number }, body: string) => {
    await execute(ctx, postsCreateOp, userActor(user), { threadId, body });
    await settle();
  };
  const jobs = (type: string) =>
    ctx.sqlite
      .prepare<{ n: number }, [string]>("SELECT count(*) AS n FROM jobs WHERE type = ?1")
      .get(type)!.n;
  const notices = (userId: number) =>
    ctx.sqlite
      .prepare<{ id: number; actor_count: number; email_sent_at: number | null }, [number]>(
        "SELECT id, actor_count, email_sent_at FROM notifications WHERE user_id = ?1 AND type = 'thread.watched'",
      )
      .all(userId);
  return {
    ctx,
    capture,
    received,
    rendered,
    author,
    replier,
    on,
    off,
    unset,
    quiet,
    reply,
    jobs,
    notices,
  };
}

const address = (user: { username: string }) => `${user.username.toLowerCase()}@example.test`;
const securityItem = (notificationId: number, userId: number) => ({
  notificationId,
  userId,
  type: "account.security",
  contentType: "security",
  contentId: userId,
  threadId: null,
  actorId: null,
  data: {},
});

describe("notification channels", () => {
  test("a watched-thread reply emails and pushes members who enabled those channels", async () => {
    const f = await fixture();
    await f.reply(f.author, "First reply");
    for (const member of [f.on, f.off, f.unset, f.quiet])
      expect(f.notices(member.id)).toHaveLength(1);
    expect(f.jobs("push.send")).toBe(1);
    expect(f.received).toEqual([`/push/${f.on.id}`]);
    const subjects = new Map(f.capture.messages.map((message) => [message.to, message.subject]));
    expect(subjects.get(address(f.on))).toBe("New reply in Topic");
    expect(subjects.has(address(f.off))).toBe(false);
  });

  test("a watch that asks for email is enough unless the member turned the type's email off", async () => {
    const f = await fixture();
    await f.reply(f.author, "First reply");
    // The type's default email setting is off; the watch's email flag still sends.
    expect(f.capture.messages.map((message) => message.to).sort()).toEqual(
      [address(f.on), address(f.unset)].sort(),
    );
    expect(f.jobs("email.send")).toBe(2);
  });

  test("a reply merged into an unread group neither emails nor pushes again", async () => {
    const f = await fixture();
    await f.reply(f.author, "First reply");
    expect(f.notices(f.on.id)[0]!.email_sent_at).not.toBeNull();
    await f.reply(f.replier, "Second reply");
    const [notice] = f.notices(f.on.id);
    expect(f.notices(f.on.id)).toHaveLength(1);
    expect(notice!.actor_count).toBe(2);
    expect(f.jobs("email.send")).toBe(2);
    expect(f.capture.messages).toHaveLength(2);
    expect(f.jobs("push.send")).toBe(1);
    expect(f.received).toHaveLength(1);
  });

  test("push renders the notice in the member's language with the group count", async () => {
    const f = await fixture();
    f.ctx.sqlite.prepare("UPDATE users SET language = 'es' WHERE id = ?1").run(f.on.id);
    await f.reply(f.author, "First reply");
    expect(f.rendered.map((entry) => entry.phrase)).toEqual([
      {
        title: "Nueva respuesta en Topic",
        bodyHtml: "Un miembro respondió en un tema que sigues: Topic.",
        bodyWithoutContentHtml: "Un miembro respondió en un tema que sigues: Topic.",
      },
    ]);
    await f.reply(f.replier, "Second reply");
    const [notice] = f.notices(f.on.id);
    const item = {
      notificationId: notice!.id,
      userId: f.on.id,
      type: "thread.watched",
      contentType: "post",
      contentId: 0,
      threadId: null,
      actorId: null,
      data: {},
    };
    expect(notificationPushPhrase(f.ctx)(item, "es").title).toBe(
      "2 miembros respondieron en Topic",
    );
  });

  test("listings report email on for watch types with no stored preference", async () => {
    const ctx = createTestContext();
    cleanup.push(() => ctx.sqlite.close(true));
    const member = userActor(insertUser(ctx));
    const types = (await execute(ctx, notificationsTypesOp, member, {})).items;
    const preferences = (await execute(ctx, notificationsPreferencesOp, member, {})).items;
    for (const type of ["thread.watched", "node.thread", "node.post"]) {
      expect(types.find((item) => item.id === type)!.defaults.email).toBe(true);
      expect(preferences.find((item) => item.type === type)!.email).toBe(true);
    }
    expect(preferences.find((item) => item.type === "member.followed")!.email).toBe(false);
  });

  test("email is not queued for a context without email jobs", async () => {
    const ctx = createTestContext();
    cleanup.push(() => ctx.sqlite.close(true));
    const user = insertUser(ctx);
    const id = ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO notifications (user_id, type, content_type, content_id, created_at, updated_at) VALUES (?1, 'account.security', 'security', ?1, ?2, ?2) RETURNING id",
      )
      .get(user.id, ctx.now())!.id;
    deliverEmail(
      ctx,
      [securityItem(id, user.id), { ...securityItem(id, user.id), type: "member.followed" }],
      notificationChannels,
    );
    expect(ctx.sqlite.prepare("SELECT id FROM jobs").get()).toBeNull();
    expect(
      ctx.sqlite
        .prepare<{ email_window_count: number }, [number]>(
          "SELECT email_window_count FROM users WHERE id = ?1",
        )
        .get(user.id)!.email_window_count,
    ).toBe(0);
  });

  test("security email ignores an opt-out", async () => {
    const f = await fixture();
    const ctx = f.ctx;
    ctx.sqlite
      .prepare(
        "INSERT INTO notification_preferences (user_id, type, email) VALUES (?1, 'account.security', 0)",
      )
      .run(f.on.id);
    const id = ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO notifications (user_id, type, content_type, content_id, created_at, updated_at) VALUES (?1, 'account.security', 'security', ?1, ?2, ?2) RETURNING id",
      )
      .get(f.on.id, ctx.now())!.id;
    deliverEmail(ctx, [securityItem(id, f.on.id)], notificationChannels);
    await runDueJobs(ctx);
    expect(f.capture.messages.map((message) => message.subject)).toEqual([
      "Account security notice",
    ]);
  });
});
