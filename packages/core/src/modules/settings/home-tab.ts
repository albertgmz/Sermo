import type * as z from "zod";
import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import type { HomeTabSetting } from "../../contracts/settings";
import type { HomeTab } from "../../db/schema";
import { ValidationError } from "../../errors";
import { markPublic } from "../../operation";
import { actorFacts, assertRule, evaluate, guestFacts } from "../../shared/criteria";

type Setting = z.infer<typeof HomeTabSetting>;

/**
 * Refuses a home tab setting a request could not serve: a rule that names a criterion too heavy
 * to read on every home page, and `following` (it needs an account) chosen by a rule a guest
 * meets, or as the fallback, which guests get. The issue path names the entry.
 */
export function assertHomeTab(ctx: Ctx, setting: Setting): void {
  const refuse = (path: (string | number)[], message: string): never => {
    throw new ValidationError(message, [{ path: ["homeTab", ...path], message }]);
  };
  const guest = guestFacts(ctx);
  setting.rules.forEach((entry, index) => {
    try {
      assertRule(ctx, entry.rule, "cheap");
    } catch (error) {
      if (error instanceof ValidationError) refuse(["rules", index, "rule"], error.message);
      throw error;
    }
    if (entry.tab === "following" && evaluate(entry.rule, guest))
      refuse(
        ["rules", index, "tab"],
        "This rule can apply to guests, who have no Following tab: add a condition that needs an account.",
      );
  });
  if (setting.fallback === "following")
    refuse(["fallback"], "The fallback also applies to guests, who have no Following tab.");
}

const homeTabOf = (ctx: Ctx, userId: number): HomeTab | null =>
  prepared(ctx, "settings.homeTab", () =>
    ctx.sqlite.prepare<{ home_tab: HomeTab | null }, [number]>(
      "SELECT home_tab FROM users WHERE id = ?1",
    ),
  ).get(userId)?.home_tab ?? null;

/**
 * The tab of the home page the actor opens on when the address names none: their own choice,
 * else the first rule of the site setting they meet, else its fallback. Guests are decided by
 * the same rules and never get `following`. The rules take cheap criteria only: one read of the
 * member's own row.
 */
export const resolveHomeTab = markPublic(
  "Decides nothing itself: the setting and the viewer's own choice and facts pick a tab.",
  function resolveHomeTab(ctx: Ctx, actor: Actor, setting: Setting): HomeTab {
    const userId = actorUserId(actor);
    const own = userId === null ? null : homeTabOf(ctx, userId);
    const { rules, fallback } = setting;
    let tab = own ?? fallback;
    if (own === null && rules.length > 0) {
      const facts = actorFacts(
        ctx,
        actor,
        rules.map((entry) => entry.rule),
      );
      tab = rules.find((entry) => evaluate(entry.rule, facts))?.tab ?? fallback;
    }
    return tab === "following" && userId === null ? "latest" : tab;
  },
);
