import { requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import { profilesAcceptAdult, profilesSetBirthDate } from "../../contracts/profiles";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import {
  adultEligibility,
  adultFacts,
  adultModeOn,
  currentActor,
  memberAdultRefusal,
  requirePermission,
} from "../../permissions";

const BIRTH_DATE_SET = "Your date of birth is already stored; staff can change it.";
const two = (value: number) => String(value).padStart(2, "0");

/**
 * While the +18 mode is on, a member's full date of birth, once stored, is staff's to change: it
 * decides what they may see. Refuses a member's own edit that would change or remove it (sending
 * the stored date again changes nothing and passes). Call inside the write transaction.
 */
export function requireBirthDateOpen(
  ctx: Ctx,
  userId: number,
  birthday: { year?: number; month: number; day: number } | null,
): void {
  if (!adultModeOn(ctx)) return;
  const facts = adultFacts(ctx, userId);
  if (!facts || facts.birth_year === null || facts.birthday_md === null) return;
  const same =
    birthday !== null &&
    birthday.year === facts.birth_year &&
    `${two(birthday.month)}-${two(birthday.day)}` === facts.birthday_md;
  if (!same) throw new ForbiddenError(BIRTH_DATE_SET);
}

export const profilesSetBirthDateOp = implement(profilesSetBirthDate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "profile.editOwn");
  const { year, month, day } = input;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1)
    throw new ValidationError("That date does not exist.");
  if (date.getTime() > ctx.now())
    throw new ValidationError("A date of birth cannot be in the future.");
  writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "profile.editOwn");
    // Only while no full date is stored: a date given, or a day kept without its year, is not one.
    const changed = ctx.sqlite
      .prepare(
        "UPDATE users SET birth_year = ?2, birthday_md = ?3 WHERE id = ?1 AND (birth_year IS NULL OR birthday_md IS NULL)",
      )
      .run(user.userId, year, `${two(month)}-${two(day)}`);
    if (changed.changes === 0) throw new ForbiddenError(BIRTH_DATE_SET);
  });
  return { refusal: adultEligibility(ctx, actor) };
});

export const profilesAcceptAdultOp = implement(
  profilesAcceptAdult,
  (ctx, actor) => {
    const user = requireAuthenticated(actor);
    writeTx(ctx, () => {
      const facts = adultFacts(ctx, user.userId);
      if (!facts) throw new NotFoundError();
      const refusal = memberAdultRefusal(facts, ctx.now());
      if (refusal === "birthDate")
        throw new ConflictError("Store your date of birth before confirming the +18 warning.");
      if (refusal === "minor") throw new ForbiddenError("+18 content is for adults only.");
      ctx.sqlite
        .prepare(
          "UPDATE users SET adult_accepted_at = ?2 WHERE id = ?1 AND adult_accepted_at IS NULL",
        )
        .run(user.userId, ctx.now());
    });
    return { refusal: adultEligibility(ctx, actor) };
  },
  {
    public:
      "Any member records their own answer to the +18 warning; whether they are old enough is decided from their stored date of birth.",
  },
);
