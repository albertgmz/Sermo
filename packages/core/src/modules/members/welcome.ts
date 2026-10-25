import { type Ctx, prepared } from "../../context";
import { GROUP_IDS, GUEST_ACCOUNT_ID } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ValidationError } from "../../errors";
import { languageFor, phrase } from "../../i18n";
import {
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
} from "../../permissions";
import { renderContent } from "../../render";
import { deliverMessages, type MessageContent, reachable } from "../broadcasts/deliver";
import { readSiteSettings } from "../settings";

/*
 * The welcome message: a private conversation from the site to each new member, sent once, when
 * the account becomes a confirmed member (its email confirmed and, on a site that approves
 * sign-ups, approved). Every place that can make an account one calls `welcomeNewMember`, which
 * decides from the account's state alone, so the order of those steps does not matter.
 * `users.welcome_due` is what makes it once: a sign-up sets it, the message (or a site that sends
 * none) clears it, and accounts that existed before the setting never had it.
 */

type Site = ReturnType<typeof readSiteSettings>;
type Message = Site["welcomeMessage"];

const TITLE_MAX = 150;

/** The text of the message for one member: the setting's own, else the default of their language. */
function textFor(message: Message, site: Site, memberLanguage: string | null, username: string) {
  const language = languageFor(memberLanguage, site.defaultLanguage);
  const values = { site: site.siteName, name: username };
  const fill = (text: string) => text.replaceAll("{name}", username);
  const subject =
    message.subject === "" ? phrase(language, "welcome.subject", values) : fill(message.subject);
  const body = message.body === "" ? phrase(language, "welcome.body", values) : fill(message.body);
  return { subject: subject.slice(0, TITLE_MAX), body };
}

/** A member who can send it: not erased, and not the account that guest posts belong to. */
function isUsableSender(ctx: Ctx, userId: number): boolean {
  return !!prepared(ctx, "welcome.sender", () =>
    ctx.sqlite.prepare<{ id: number }, [number, number]>(
      "SELECT id FROM users WHERE id = ?1 AND id <> ?2 AND erased_at IS NULL",
    ),
  ).get(userId, GUEST_ACCOUNT_ID);
}

/** The sender the setting names, else the first administrator; null when there is none. */
function senderOf(ctx: Ctx, message: Message): number | null {
  if (message.senderId !== null)
    return isUsableSender(ctx, message.senderId) ? message.senderId : null;
  return (
    prepared(ctx, "welcome.firstAdministrator", () =>
      ctx.sqlite.prepare<{ id: number }, [number]>(
        "SELECT id FROM users WHERE group_id = ?1 AND erased_at IS NULL ORDER BY id LIMIT 1",
      ),
    ).get(GROUP_IDS.admin)?.id ?? null
  );
}

/** The text rendered as the sender would post it. Throws ValidationError when it cannot be. */
function contentFor(
  ctx: Ctx,
  senderId: number,
  text: { subject: string; body: string },
): MessageContent {
  const row = prepared(ctx, "welcome.principal", () =>
    ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number }, [number]>(
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
    ),
  ).get(senderId);
  if (!row) throw new Error("The welcome message sender is gone.");
  const rendered = renderContent(
    ctx,
    memberActor(row.id, row.group_id, row, currentVersions(ctx)),
    text.body,
  );
  return {
    kind: "message",
    senderId,
    title: text.subject,
    source: rendered.source,
    html: rendered.html,
    spoilers: rendered.spoilers,
    mentionedUserIds: rendered.mentionedUserIds,
    quotes: rendered.quotes,
    locked: false,
    removeFromSender: false,
  };
}

/**
 * Refuses a setting that could not be sent: a sender who is not a member, or a text that does not
 * render as that sender (for instance one that quotes a post that is gone). Runs when the setting
 * is saved, so the administrator hears of it then and not in the log.
 */
export function assertWelcomeMessage(ctx: Ctx, message: Message): void {
  const refuse = (key: "senderId" | "body", text: string) =>
    new ValidationError(text, [{ path: ["welcomeMessage", key], message: text }]);
  if (message.senderId !== null && !isUsableSender(ctx, message.senderId))
    throw refuse("senderId", "There is no member with this id.");
  const senderId = senderOf(ctx, message);
  if (senderId === null || message.body === "") return;
  try {
    contentFor(ctx, senderId, { subject: "", body: message.body.replaceAll("{name}", "Name") });
  } catch (error) {
    if (error instanceof ValidationError) throw refuse("body", error.message);
    throw error;
  }
}

/**
 * Call it wherever an account may just have become a confirmed member. It does nothing for an
 * account that is not due a welcome, or is not a confirmed member yet (unconfirmed, awaiting
 * approval, banned or erased). A failure to send is logged and leaves the account due, so the
 * next such step tries again; it never fails the step that called it. Run it in that step's
 * write transaction.
 */
export function welcomeNewMember(ctx: Ctx, userId: number): void {
  const due = prepared(ctx, "welcome.due", () =>
    ctx.sqlite.prepare<{ username: string; language: string | null }, [number]>(
      "SELECT username, language FROM users WHERE id = ?1 AND welcome_due = 1",
    ),
  ).get(userId);
  if (!due) return;
  const [recipient] = reachable(ctx, [userId]);
  if (!recipient) return;
  try {
    writeTx(ctx, () => {
      const claimed = prepared(ctx, "welcome.claim", () =>
        ctx.sqlite.prepare("UPDATE users SET welcome_due = 0 WHERE id = ?1 AND welcome_due = 1"),
      ).run(userId);
      if (claimed.changes === 0) return;
      const site = readSiteSettings(ctx);
      const message = site.welcomeMessage;
      if (!message.enabled) return;
      const senderId = senderOf(ctx, message);
      if (senderId === null) throw new Error("The welcome message has no sender to send it as.");
      // Nobody writes to themselves: the sender's own sign-up needs no welcome.
      if (senderId === userId) return;
      deliverMessages(
        ctx,
        contentFor(ctx, senderId, textFor(message, site, due.language, due.username)),
        [recipient],
      );
    });
  } catch (error) {
    console.error("[members.welcome]", { userId }, error);
  }
}
