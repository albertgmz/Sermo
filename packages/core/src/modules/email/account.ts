import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { registerEventSubscriber } from "../../events";
import { languageFor } from "../../i18n";
import { type AccountTemplate, renderAccountEmail } from "../../mail/template";
import { enqueueJob, MAX_ATTEMPTS, registerJobHandler } from "../jobs/queue";
import { readSiteSettings } from "../settings";
import { siteBranding } from "./branding";
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
  /** For "newDevice": the device and place the sign-in came from, and when. */
  device?: { browser: string | null; os: string | null };
  location?: { country: string | null; region: string | null; city: string | null };
  at?: number;
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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function registerAccountEmailJobs(ctx: Ctx): void {
  // The member of a rejected sign-up was erased: the job must not keep their address once it is
  // done with it (sent, or given up on).
  const dropAddress = (jobId: number) =>
    writeTx(ctx, () =>
      ctx.sqlite
        .prepare("UPDATE jobs SET payload = json_set(payload, '$.email', '') WHERE id = ?1")
        .run(jobId),
    );
  registerJobHandler(
    ctx,
    "email.account",
    async (_context, payload, claimed) => {
      const job = payload as AccountJob;
      if (!job || typeof job.email !== "string" || !Number.isSafeInteger(job.userId))
        throw new Error("Invalid account email job.");
      const state = accountMailState(ctx);
      // The member of a rejected sign-up was erased: the job drops their address on every way out.
      const erased = job.kind === "signupRejected";
      const finish = () => {
        if (erased) dropAddress(claimed.id);
      };
      if (!state || state.config.driver === "none") return finish();
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
          return finish();
      }
      if (undeliverable(ctx, job.email.toLowerCase())) return finish();
      const member = prepared(ctx, "accountEmail.member", () =>
        ctx.sqlite.prepare<{ language: string | null }, [number]>(
          "SELECT language FROM users WHERE id = ?1",
        ),
      ).get(job.userId);
      if (!member) return finish();
      try {
        const settings = readSiteSettings(ctx);
        const rendered = await renderAccountEmail({
          kind: job.kind,
          language: languageFor(member.language, settings.defaultLanguage),
          brand: siteBranding(ctx, settings),
          ...(job.url ? { url: job.url } : {}),
          ...(job.reason ? { reason: job.reason } : {}),
          ...(job.expiresAt !== undefined ? { expiresAt: job.expiresAt } : {}),
          ...(job.kind === "newDevice" && job.at !== undefined
            ? {
                signIn: {
                  browser: job.device?.browser ?? null,
                  os: job.device?.os ?? null,
                  country: job.location?.country ?? null,
                  region: job.location?.region ?? null,
                  city: job.location?.city ?? null,
                  at: job.at,
                },
              }
            : {}),
        });
        await state.mailer.send({
          to: job.email,
          from: state.config.sender,
          ...(state.config.replyTo ? { replyTo: state.config.replyTo } : {}),
          ...rendered,
        });
        finish();
      } catch (error) {
        const rejected = mailboxRejected(error);
        const attempts =
          prepared(ctx, "accountEmail.attempts", () =>
            ctx.sqlite.prepare<{ attempts: number }, [number]>(
              "SELECT attempts FROM jobs WHERE id = ?1",
            ),
          ).get(claimed.id)?.attempts ?? 0;
        const last = rejected || attempts >= MAX_ATTEMPTS;
        // No record of the failure keeps the erased member's address, the job's own error included.
        const clean =
          erased && error instanceof Error
            ? new Error(error.message.replace(new RegExp(escapeRegExp(job.email), "gi"), ""))
            : error;
        recordFailure(
          ctx,
          job.userId,
          erased ? `erased-${job.userId}@invalid` : job.email,
          job.kind,
          clean,
          last,
          erased ? false : rejected,
        );
        if (erased && last) dropAddress(claimed.id);
        if (!rejected) throw clean;
      }
    },
    {
      // A job that runs out of attempts without a handler's say (leases that expire) is cleaned too.
      onFailed: (_ctx, failed) => {
        const job = failed.payload as { kind?: unknown } | null;
        if (job?.kind === "signupRejected") dropAddress(failed.id);
      },
    },
  );
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
