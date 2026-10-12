import { awardsList, awardsMemberGrants } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { AwardIcon } from "@/components/forum/award-icon";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { MemberChoice } from "../credits/member-choice";
import { EconomyNotice, one } from "../credits/shared";
import { memberNames } from "../logs/links";
import { grantAward, revokeGrant } from "./actions";

// Pick a member (the choice is in the address), then grant an award to them and see the grants
// they hold with a revoke on each.
export async function GrantsScreen({
  searchParams,
}: {
  searchParams: PageProps<"/admin/award-grants">["searchParams"];
}) {
  const params = await searchParams;
  const [t, format] = await Promise.all([
    getTranslations("adminEconomy.grants"),
    getFormatter(),
  ]);
  const userId = parseId(one(params.userId));
  const notices = {
    granted: t("notices.granted"),
    revoked: t("notices.revoked"),
  };
  const picker = (
    <MemberChoice
      path="/admin/award-grants"
      userId={userId}
      params={params}
      heading={t("member")}
    />
  );
  if (userId === null) {
    return (
      <>
        <EconomyNotice searchParams={searchParams} shown={notices} />
        {picker}
      </>
    );
  }
  const [awards, grants] = await Promise.all([
    call(awardsList, {}),
    call(awardsMemberGrants, {
      userId,
      cursor: cursorFrom(params, "grants"),
    }),
  ]);
  const name = await memberNames([
    userId,
    ...grants.items.flatMap((grant) =>
      grant.grantedBy ? [grant.grantedBy.id] : [],
    ),
  ]);
  const offered = awards.items.filter((award) => award.isActive);
  return (
    <>
      <EconomyNotice searchParams={searchParams} shown={notices} />
      {picker}
      <FormRows
        action={grantAward}
        heading={t("grantHeading", { name: name(userId) })}
        description={t("grantHelp")}
        submit={t("grant")}
      >
        <input type="hidden" name="userId" value={userId} />
        <FieldRow name="awardId" label={t("award")} htmlFor="grant-award">
          <select
            id="grant-award"
            name="awardId"
            required
            className={selectClass}
          >
            {offered.map((award) => (
              <option key={award.id} value={award.id}>
                {award.name}
                {award.isStackable ? ` (${t("stackable")})` : ""}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow
          name="reason"
          label={t("note")}
          htmlFor="grant-reason"
          help={t("noteHelp")}
        >
          <Input id="grant-reason" name="reason" />
        </FieldRow>
      </FormRows>
      <CursorList
        items={grants.items}
        nextCursor={grants.nextCursor}
        path="/admin/award-grants"
        params={params}
        cursorParam="grants"
        itemKey={(grant) => grant.id}
        label={t("heldLabel")}
        head={
          <div className="border-b p-4">
            <h2 className="text-sm font-semibold">
              {t("heldHeading", { name: name(userId) })}
            </h2>
          </div>
        }
        empty={{ title: t("none") }}
        render={(grant) => (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-4 text-sm">
            <AwardIcon award={grant.award} size="md" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-2 font-medium [overflow-wrap:anywhere]">
                {grant.award.name}
                <Badge variant="secondary">
                  {t(`tiers.${grant.award.tier}`)}
                </Badge>
              </p>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {format.dateTime(new Date(grant.grantedAt), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                {" · "}
                {grant.grantedBy
                  ? t("by", { name: name(grant.grantedBy.id) })
                  : t("automatic")}
                {grant.reason && ` · ${grant.reason}`}
              </p>
            </div>
            <ConfirmStep
              action={revokeGrant}
              fields={{ userId, memberAwardId: grant.id }}
              summary={t("revoke")}
              reason={t("revokeReason")}
              warning={t("revokeWarning")}
            />
          </div>
        )}
      />
    </>
  );
}
