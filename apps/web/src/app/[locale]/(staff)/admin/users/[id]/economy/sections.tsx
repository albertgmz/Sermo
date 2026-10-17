import {
  awardsList,
  awardsMemberGrants,
  creditsLedger,
  shopInventory,
} from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { UserLink } from "@/components/forum/user-link";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { cursorFrom } from "@/components/staff/cursor-list";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { call } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { ifAllowed } from "../../data";
import { PagedItems } from "../../paged-items";
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
    <PagedItems
      items={page.items.map((row) => ({
        id: row.id,
        title: (
          <>
            <span
              className={`tabular-nums ${row.amount < 0 ? "text-destructive" : "text-success"}`}
            >
              {row.amount > 0 ? "+" : ""}
              {format.number(row.amount)}
            </span>{" "}
            {row.reason}
          </>
        ),
        badges: <Badge variant="secondary">{row.type}</Badge>,
        description: (
          <>
            {row.actor ? (
              <>
                {t("by")} <span>{row.actor.username}</span> ·{" "}
              </>
            ) : null}
            {row.source ? `${row.source.type} #${row.source.id} · ` : ""}
            {t("after", { balance: format.number(row.balanceAfter) })} ·{" "}
            <Time at={row.createdAt} />
          </>
        ),
      }))}
      nextCursor={page.nextCursor}
      path={`/admin/users/${userId}/economy`}
      params={params}
      cursorParam="ledger"
      label={t("ledger")}
      heading={t("ledger")}
      description={`${t("balance")} ${format.number(page.balance ?? balance)}`}
      empty={{ title: t("noLedger") }}
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
      <EditForm action={adjustCredits} submit={t("adjust")} disabled={readOnly}>
        <input type="hidden" name="id" value={userId} />
        <FieldGroup
          legend={t("adjustFormHeading")}
          description={t("adjustHelp")}
        >
          <Field name="amount" label={t("amount")} htmlFor="adjust-amount">
            <Input
              id="adjust-amount"
              name="amount"
              type="number"
              inputMode="numeric"
              required
            />
          </Field>
          <Field name="reason" label={t("reason")} htmlFor="adjust-reason">
            <Input id="adjust-reason" name="reason" required />
          </Field>
          <Field name="confirm" label={t("confirmLabel")}>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="confirm"
                required
                className="size-5"
              />
              {t("confirm")}
            </label>
          </Field>
        </FieldGroup>
      </EditForm>
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
    <PagedItems
      items={page.items.map((entry) => ({
        id: entry.id,
        title: (
          <>
            {entry.item.name}
            {entry.quantity > 1 && ` × ${format.number(entry.quantity)}`}
          </>
        ),
        description: (
          <>
            {t("acquired")} <Time at={entry.acquiredAt} />
            {entry.expiresAt && (
              <>
                {" "}
                · {t("expires")} <Time at={entry.expiresAt} />
              </>
            )}
          </>
        ),
      }))}
      nextCursor={page.nextCursor}
      path={`/admin/users/${userId}/economy`}
      params={params}
      cursorParam="inventory"
      label={t("inventory")}
      heading={t("inventory")}
      filters={
        <form method="get" className="flex flex-wrap items-end gap-3">
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
        <PagedItems
          items={grants.items.map((grant) => ({
            id: grant.id,
            title: grant.award.name,
            badges: <Badge variant="secondary">{grant.award.tier}</Badge>,
            description: (
              <>
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
              </>
            ),
            actions:
              mayGrant && !readOnly ? (
                <ConfirmStep
                  action={revokeAward}
                  fields={{ id: userId, memberAwardId: grant.id }}
                  summary={t("revoke")}
                  reason={t("revokeReason")}
                  warning={t("revokeWarning")}
                />
              ) : undefined,
          }))}
          nextCursor={grants.nextCursor}
          path={`/admin/users/${userId}/economy`}
          params={params}
          cursorParam="awards"
          label={t("awards")}
          heading={t("awards")}
          empty={{ title: t("noAwards") }}
        />
      )}
      {mayGrant && awards && (
        <EditForm action={grantAward} submit={t("grant")} disabled={readOnly}>
          <input type="hidden" name="id" value={userId} />
          <FieldGroup legend={t("grantHeading")}>
            <Field name="awardId" label={t("award")} htmlFor="grant-award">
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
            </Field>
            <Field name="reason" label={t("reason")} htmlFor="grant-reason">
              <Input id="grant-reason" name="reason" />
            </Field>
          </FieldGroup>
        </EditForm>
      )}
    </>
  );
}
