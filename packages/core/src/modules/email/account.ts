import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { registerEventSubscriber } from "../../events";
import { languageFor } from "../../i18n";
import { type AccountTemplate, renderAccountEmail } from "../../mail/template";
import { enqueueJob, MAX_ATTEMPTS, registerJobHandler } from "../jobs/queue";
import { readSiteSettings } from "../settings";
import { accountMailState, mailboxRejected, recordFailure, undeliverable } from "./index";

type AccountJob = {
  kind: AccountTemplate;
  userId: number;
  email: string;
  url?: string;
  reason?: string;
  expiresAt?: string | null;
  eventId?: number;
  banId?: number;
};

/** Account mail is available only after the server has configured a delivery driver. */
export function accountEmailEnabled(ctx: Ctx): boolean {
  const state = accountMailState(ctx);
  return !!state && state.config.driver !== "none";
}

export function queueAccountEmail(ctx: Ctx, job: AccountJob, uniqueKey?: string): void {
  if (!accountEmailEnabled(ctx)) return;
  enqueueJob(ctx, "email.account", job, uniqueKey ? { uniqueKey } : {});
}

export function registerAccountEmailJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "email.account", async (_context, payload, claimed) => {
    const job = payload as AccountJob;
    if (!job || typeof job.email !== "string" || !Number.isSafeInteger(job.userId))
      throw new Error("Invalid account email job.");
    const state = accountMailState(ctx);
    if (!state || state.config.driver === "none") return;
    if (job.banId !== undefined) {
      const ban = prepared(ctx, "accountEmail.activeBan", () =>
        ctx.sqlite.prepare<
          { expires_at: number | null; lifted_at: number | null },
          [number, number]
        >("SELECT expires_at, lifted_at FROM bans WHERE id = ?1 AND user_id = ?2"),
      ).get(job.banId, job.userId);
      if (
        !ban ||
        ban.lifted_at !== null ||
        (ban.expires_at !== null && ban.expires_at <= ctx.now())
      )
        return;
    }
    if (undeliverable(ctx, job.email.toLowerCase())) return;
    const member = prepared(ctx, "accountEmail.member", () =>
      ctx.sqlite.prepare<{ language: string | null }, [number]>(
        "SELECT language FROM users WHERE id = ?1",
      ),
    ).get(job.userId);
    if (!member) return;
    try {
      const settings = readSiteSettings(ctx);
      const rendered = await renderAccountEmail({
        kind: job.kind,
        language: languageFor(member.language, settings.defaultLanguage),
        site: settings.siteName,
        ...(job.url ? { url: job.url } : {}),
        ...(job.reason ? { reason: job.reason } : {}),
        ...(job.expiresAt !== undefined ? { expiresAt: job.expiresAt } : {}),
      });
      await state.mailer.send({
        to: job.email,
        from: state.config.sender,
        ...(state.config.replyTo ? { replyTo: state.config.replyTo } : {}),
        ...rendered,
      });
    } catch (error) {
      const rejected = mailboxRejected(error);
      const attempts =
        prepared(ctx, "accountEmail.attempts", () =>
          ctx.sqlite.prepare<{ attempts: number }, [number]>(
            "SELECT attempts FROM jobs WHERE id = ?1",
          ),
        ).get(claimed.id)?.attempts ?? 0;
      recordFailure(
        ctx,
        job.userId,
        job.email,
        job.kind,
        error,
        rejected || attempts >= MAX_ATTEMPTS,
        rejected,
      );
      if (!rejected) throw error;
    }
  });
  writeTx(ctx, () => {
    ctx.sqlite
      .prepare(
        "INSERT OR IGNORE INTO event_subscribers (name, last_event_id, updated_at) SELECT 'email.account.bans', COALESCE(MAX(id), 0), ?1 FROM domain_events",
      )
      .run(ctx.now());
  });
  registerEventSubscriber(ctx, "email.account.bans", (event) => {
    if (
      event.type !== "member.banned" ||
      event.payload.lifted === true ||
      event.payload.notify === false
    )
      return;
    const banId = Number(event.payload.banId);
    if (!Number.isSafeInteger(banId) || banId <= 0 || !accountEmailEnabled(ctx)) return;
    const member = prepared(ctx, "accountEmail.banRecipient", () =>
      ctx.sqlite.prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1"),
    ).get(event.targetId);
    if (!member) return;
    writeTx(ctx, () => {
      const marked = ctx.sqlite
        .prepare(
          "INSERT OR IGNORE INTO event_subscribers (name, last_event_id, updated_at) VALUES (?1, ?2, ?3)",
        )
        .run(`email.account.ban.${banId}`, event.id, ctx.now()).changes;
      if (!marked) return;
      queueAccountEmail(
        ctx,
        {
          kind: "banned",
          userId: event.targetId,
          email: member.email,
          reason:
            typeof event.payload.message === "string" && event.payload.message.trim()
              ? event.payload.message
              : String(event.payload.reason ?? ""),
          expiresAt: typeof event.payload.expiresAt === "string" ? event.payload.expiresAt : null,
          eventId: event.id,
          banId,
        },
        `email.account.ban:${banId}`,
      );
    });
  });
}
