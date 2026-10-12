import {
  awardsList,
  awardsMemberGrants,
  creditsLedger,
  shopInventory,
} from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { UserLink } from "@/components/forum/user-link";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { call } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { ifAllowed } from "../../data";
import { InlineAction } from "../../inline-action";
import { adjustCredits, grantAward, revokeAward } from "./actions";

const SHOP_INVENTORY_STATES = shopInventory.input.shape.state.options;

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

async function Time({ at }: { at: string }) {
  const format = await getFormatter();
  return (
    <time dateTime={at}>
      {format.dateTime(new Date(at), {
        dateStyle: "medium",
        timeStyle: "short",
      })}
    </time>
  );
}

export async function Ledger({
  userId,
  params,
  balance,
}: {
  userId: number;
  params: Params;
  balance: number;
}) {
  const [t, format, page] = await Promise.all([
    getTranslations("adminUsers.economy"),
    getFormatter(),
    call(creditsLedger, { userId, cursor: cursorFrom(params, "ledger") }),
  ]);
  return (
    <CursorList
      items={page.items}
      nextCursor={page.nextCursor}
      path={`/admin/users/${userId}/economy`}
      params={params}
      cursorParam="ledger"
      itemKey={(row) => row.id}
      label={t("ledger")}
      head={
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4">
          <h2 className="text-sm font-semibold">{t("ledger")}</h2>
          <p className="text-sm">
            {t("balance")}{" "}
            <strong className="tabular-nums">
              {format.number(page.balance ?? balance)}
            </strong>
          </p>
        </div>
      }
      empty={{ title: t("noLedger") }}
      render={(row) => (
        <div className="grid gap-1 p-4 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-start sm:gap-4">
          <p
            className={`font-semibold tabular-nums ${row.amount < 0 ? "text-destructive" : "text-success"}`}
          >
            {row.amount > 0 ? "+" : ""}
            {format.number(row.amount)}
          </p>
          <div className="min-w-0 space-y-0.5 [overflow-wrap:anywhere]">
            <p>
              <Badge variant="secondary">{row.type}</Badge> {row.reason}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.actor ? (
                <>
                  {t("by")} <span>{row.actor.username}</span> ·{" "}
                </>
              ) : null}
              {row.source ? `${row.source.type} #${row.source.id} · ` : ""}
              {t("after", { balance: format.number(row.balanceAfter) })}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            <Time at={row.createdAt} />
          </p>
        </div>
      )}
    />
  );
}

export async function Adjust({
  userId,
  readOnly,
}: {
  userId: number;
  readOnly: boolean;
}) {
  const t = await getTranslations("adminUsers.economy");
  return (
    <details className="rounded-lg border bg-card">
      <summary className="flex min-h-10 cursor-pointer items-center px-4 py-3 text-sm font-semibold">
        {t("adjustHeading")}
      </summary>
      <FormRows
        action={adjustCredits}
        heading={t("adjustFormHeading")}
        description={t("adjustHelp")}
        submit={t("adjust")}
        disabled={readOnly}
      >
        <input type="hidden" name="id" value={userId} />
        <FieldRow name="amount" label={t("amount")} htmlFor="adjust-amount">
          <Input
            id="adjust-amount"
            name="amount"
            type="number"
            inputMode="numeric"
            required
          />
        </FieldRow>
        <FieldRow name="reason" label={t("reason")} htmlFor="adjust-reason">
          <Input id="adjust-reason" name="reason" required maxLength={500} />
        </FieldRow>
        <FieldRow name="confirm" label={t("confirmLabel")}>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="checkbox" name="confirm" required className="size-5" />
            {t("confirm")}
          </label>
        </FieldRow>
      </FormRows>
    </details>
  );
}

export async function Inventory({
  userId,
  params,
}: {
  userId: number;
  params: Params;
}) {
  const state = one(params.state);
  const chosen = (SHOP_INVENTORY_STATES as readonly string[]).includes(state)
    ? (state as (typeof SHOP_INVENTORY_STATES)[number])
    : "active";
  const [t, format, page] = await Promise.all([
    getTranslations("adminUsers.economy"),
    getFormatter(),
    call(shopInventory, {
      userId,
      state: chosen,
      cursor: cursorFrom(params, "inventory"),
    }),
  ]);
  return (
    <CursorList
      items={page.items}
      nextCursor={page.nextCursor}
      path={`/admin/users/${userId}/economy`}
      params={params}
      cursorParam="inventory"
      itemKey={(entry) => entry.id}
      label={t("inventory")}
      filters={
        <form method="get" className="flex flex-wrap items-end gap-3">
          <h2 className="mr-auto text-sm font-semibold">{t("inventory")}</h2>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("inventoryState")}
            <select
              name="state"
              defaultValue={chosen}
              className={`${selectClass} sm:w-44`}
            >
              {SHOP_INVENTORY_STATES.map((value) => (
                <option key={value} value={value}>
                  {t(`inventoryStates.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="outline" className="min-h-10 px-4">
            {t("show")}
          </Button>
        </form>
      }
      empty={{ title: t("noInventory") }}
      render={(entry) => (
        <div className="space-y-0.5 p-4 text-sm">
          <p className="font-medium [overflow-wrap:anywhere]">
            {entry.item.name}
            {entry.quantity > 1 && ` × ${format.number(entry.quantity)}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("acquired")} <Time at={entry.acquiredAt} />
            {entry.expiresAt && (
              <>
                {" "}
                · {t("expires")} <Time at={entry.expiresAt} />
              </>
            )}
          </p>
        </div>
      )}
    />
  );
}

export async function Awards({
  userId,
  params,
  mayGrant,
  readOnly,
}: {
  userId: number;
  params: Params;
  mayGrant: boolean;
  readOnly: boolean;
}) {
  const [t, grants, awards] = await Promise.all([
    getTranslations("adminUsers.economy"),
    ifAllowed(() =>
      call(awardsMemberGrants, {
        userId,
        cursor: cursorFrom(params, "awards"),
      }),
    ),
    mayGrant ? ifAllowed(() => call(awardsList, {})) : null,
  ]);
  const who = grants
    ? await membersFor(
        grants.items.flatMap((grant) =>
          grant.grantedBy ? [grant.grantedBy] : [],
        ),
      )
    : null;
  return (
    <>
      {grants && who && (
        <CursorList
          items={grants.items}
          nextCursor={grants.nextCursor}
          path={`/admin/users/${userId}/economy`}
          params={params}
          cursorParam="awards"
          itemKey={(grant) => grant.id}
          label={t("awards")}
          head={
            <div className="border-b p-4">
              <h2 className="text-sm font-semibold">{t("awards")}</h2>
            </div>
          }
          empty={{ title: t("noAwards") }}
          render={(grant) => (
            <div className="space-y-1 p-4 text-sm">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {grant.award.name}
                <Badge variant="secondary">{grant.award.tier}</Badge>
              </p>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                <Time at={grant.grantedAt} /> ·{" "}
                {grant.grantedBy ? (
                  <>
                    {t("by")}{" "}
                    <UserLink
                      user={who(grant.grantedBy.id)}
                      className="inline-flex min-h-10 items-center"
                    />
                  </>
                ) : (
                  t("automatic")
                )}
                {grant.reason && ` · ${grant.reason}`}
              </p>
              {mayGrant && !readOnly && (
                <InlineAction
                  action={revokeAward}
                  fields={{ id: userId, memberAwardId: grant.id }}
                  label={t("revoke")}
                  reason={t("revokeReason")}
                  warning={t("revokeWarning")}
                />
              )}
            </div>
          )}
        />
      )}
      {mayGrant && awards && (
        <FormRows
          action={grantAward}
          heading={t("grantHeading")}
          submit={t("grant")}
          disabled={readOnly}
        >
          <input type="hidden" name="id" value={userId} />
          <FieldRow name="awardId" label={t("award")} htmlFor="grant-award">
            <select
              id="grant-award"
              name="awardId"
              required
              className={selectClass}
            >
              {awards.items
                .filter((award) => award.isActive)
                .map((award) => (
                  <option key={award.id} value={award.id}>
                    {award.name}
                  </option>
                ))}
            </select>
          </FieldRow>
          <FieldRow name="reason" label={t("reason")} htmlFor="grant-reason">
            <Input id="grant-reason" name="reason" maxLength={500} />
          </FieldRow>
        </FormRows>
      )}
    </>
  );
}
