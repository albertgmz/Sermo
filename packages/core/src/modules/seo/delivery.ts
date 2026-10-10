import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { consumeEvents, type DomainEvent } from "../../events";
import { permissionsOf } from "../../permissions";
import { enqueueJob, registerJobHandler } from "../jobs/queue";
import { readSiteSettings } from "../settings";
import { indexNowBatches, sendIndexNow } from "./indexnow";
import { canonicalUrl } from "./paths";

type ThreadUrl = { id: number; title: string; node_id: number; state: string };
type ProfileUrl = { id: number; username: string };
type EventRow = { state: string; thread_id: number; profile_user_id: number };

function publicUrl(ctx: Ctx, event: DomainEvent, baseURL: string): string | null {
  if (event.type === "content.deleted" && event.payload.previousState !== "visible") return null;
  const guest = permissionsOf(ctx, GUEST);
  if (event.targetType === "node") {
    const node = prepared(ctx, "seo.eventNode", () =>
      ctx.sqlite.prepare<{ id: number; title: string }, [number]>(
        "SELECT id,title FROM nodes WHERE id=?1",
      ),
    ).get(event.targetId);
    return node && guest.can("node.view", { nodeId: node.id })
      ? canonicalUrl(baseURL, "node", node.id, node.title)
      : null;
  }
  if (event.targetType === "thread" || event.targetType === "post") {
    const thread =
      event.targetType === "thread"
        ? prepared(ctx, "seo.eventThread", () =>
            ctx.sqlite.prepare<ThreadUrl, [number]>(
              "SELECT id,title,node_id,state FROM threads WHERE id=?1",
            ),
          ).get(event.targetId)
        : prepared(ctx, "seo.eventPostThread", () =>
            ctx.sqlite.prepare<ThreadUrl & { post_state: string }, [number]>(
              "SELECT t.id,t.title,t.node_id,t.state,p.state AS post_state FROM posts p JOIN threads t ON t.id=p.thread_id WHERE p.id=?1",
            ),
          ).get(event.targetId);
    if (!thread || !guest.can("node.view", { nodeId: thread.node_id })) return null;
    if (thread.state !== "visible" && event.targetType !== "thread") return null;
    if (thread.state !== "visible" && event.type !== "content.deleted") return null;
    if (
      event.targetType === "post" &&
      event.type !== "content.deleted" &&
      "post_state" in thread &&
      thread.post_state !== "visible"
    )
      return null;
    return canonicalUrl(baseURL, "thread", thread.id, thread.title);
  }
  if (!guest.can("profile.view")) return null;
  let userId: number | null = null;
  if (event.targetType === "profile") userId = event.targetId;
  else if (event.targetType === "profile_post") {
    const row = prepared(ctx, "seo.eventProfilePost", () =>
      ctx.sqlite.prepare<Pick<EventRow, "state" | "profile_user_id">, [number]>(
        "SELECT state,profile_user_id FROM profile_posts WHERE id=?1",
      ),
    ).get(event.targetId);
    if (row && (row.state === "visible" || event.type === "content.deleted"))
      userId = row.profile_user_id;
  } else if (event.targetType === "profile_post_comment") {
    const row = prepared(ctx, "seo.eventProfileComment", () =>
      ctx.sqlite.prepare<Pick<EventRow, "state" | "profile_user_id">, [number]>(
        "SELECT c.state,p.profile_user_id FROM profile_post_comments c JOIN profile_posts p ON p.id=c.profile_post_id WHERE c.id=?1",
      ),
    ).get(event.targetId);
    if (row && (row.state === "visible" || event.type === "content.deleted"))
      userId = row.profile_user_id;
  }
  if (userId === null) return null;
  const profile = prepared(ctx, "seo.eventProfile", () =>
    ctx.sqlite.prepare<ProfileUrl, [number]>("SELECT id,username FROM users WHERE id=?1"),
  ).get(userId);
  return profile ? canonicalUrl(baseURL, "profile", profile.id, profile.username) : null;
}

export function queueSeoEvents(ctx: Ctx): number | null {
  enqueueJob(ctx, "seo.indexnow.send", {}, { uniqueKey: "seo.indexnow.send" });
  return enqueueJob(ctx, "seo.events", {}, { uniqueKey: "seo.events" });
}

export function registerSeoJobs(ctx: Ctx, fetcher: typeof fetch = fetch): void {
  registerJobHandler(ctx, "seo.events", async () => {
    const key = readSiteSettings(ctx).indexNowKey;
    const baseURL = ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000";
    const count = await consumeEvents(
      ctx,
      "seo.indexnow",
      (event) => {
        if (!key) return;
        const url = publicUrl(ctx, event, baseURL);
        if (!url) return;
        writeTx(ctx, () => {
          prepared(ctx, "seo.insertPending", () =>
            ctx.sqlite.prepare(
              "INSERT INTO indexnow_pending (event_id,url,created_at) VALUES (?1,?2,?3) ON CONFLICT(event_id) DO NOTHING",
            ),
          ).run(event.id, url, ctx.now());
          enqueueJob(ctx, "seo.indexnow.send", {}, { uniqueKey: "seo.indexnow.send" });
        });
      },
      1000,
    );
    if (count === 1000)
      enqueueJob(ctx, "seo.events", {}, { uniqueKey: `seo.events.next.${ctx.now()}` });
  });
  registerJobHandler(ctx, "seo.indexnow.send", async () => {
    const key = readSiteSettings(ctx).indexNowKey;
    if (!key) return;
    const rows = prepared(ctx, "seo.pending", () =>
      ctx.sqlite.prepare<{ event_id: number; url: string }, []>(
        "SELECT event_id,url FROM indexnow_pending ORDER BY event_id LIMIT 10000",
      ),
    ).all();
    if (!rows.length) return;
    const baseURL = ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000";
    await sendIndexNow(
      indexNowBatches(
        baseURL,
        key,
        rows.map((row) => row.url),
      ),
      fetcher,
    );
    writeTx(ctx, () => {
      prepared(ctx, "seo.clearSent", () =>
        ctx.sqlite.prepare(
          "DELETE FROM indexnow_pending WHERE event_id IN (SELECT value FROM json_each(?1))",
        ),
      ).run(JSON.stringify(rows.map((row) => row.event_id)));
    });
  });
}
