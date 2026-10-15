import { dispatchEvents } from "../../events";
import { resolvedActor } from "../../permissions/test-contexts";
import { promoteVerifiedMember } from "../auth";
import { runDueJobs } from "../jobs/queue";
import { registerModerationJobs } from "../moderation";
import { registerNotificationJobs } from "../notifications";
import { accounts, PASSWORD } from "./fixtures.test";

export { PASSWORD };

/**
 * A forum that approves sign-ups by hand: an administrator, a moderator (who holds
 * member.approveRegistrations by default), a member, and `join` to register newcomers who then
 * wait. With `mail` on, a newcomer is Unconfirmed until `confirm` runs.
 */
export async function queueWorld(options: { mail?: boolean } = {}) {
  const w = await accounts(options);
  registerNotificationJobs(w.ctx);
  registerModerationJobs(w.ctx);
  const founder = await w.register("Founder", 4);
  const moderator = await w.register("Moderator", 3);
  const member = await w.register("Regular");
  await w.run("settings.update", founder.actor, { approveSignups: true });
  const join = async (username: string) => {
    const created = await w.register(username);
    return created;
  };
  /** An account the site trusts (made after the queue went on): not held. */
  const staff = async (username: string, groupId: number) => {
    const created = await w.register(username, groupId);
    w.ctx.sqlite.prepare("UPDATE users SET signup_review = NULL WHERE id = ?1").run(created.id);
    return created;
  };
  /** The newcomer confirms their address: the group moves, and the queue announces them. */
  const confirm = (id: number) => promoteVerifiedMember(w.ctx, id);
  const review = (id: number) =>
    w.ctx.sqlite
      .prepare<{ signup_review: string | null }, [number]>(
        "SELECT signup_review FROM users WHERE id = ?1",
      )
      .get(id)!.signup_review;
  const as = (user: { id: number }) => resolvedActor(w.ctx, user.id);
  const drain = async () => {
    await dispatchEvents(w.ctx);
    await runDueJobs(w.ctx);
  };
  return { ...w, founder, moderator, member, join, staff, confirm, review, as, drain };
}
