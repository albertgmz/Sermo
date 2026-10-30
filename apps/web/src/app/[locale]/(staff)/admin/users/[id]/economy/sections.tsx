import {
  awardsList,
  awardsMemberGrants,
  creditsLedger,
  shopInventory,
} from "@sermo/core/contracts";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserLink } from "@/components/forum/user-link";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { cursorFrom } from "@/components/staff/cursor-list";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { PagedList } from "@/components/staff/paged-list";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCredits } from "@/lib/format";
import { call } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { ifAllowed } from "../../data";
import { adjustCredits, grantAward, revokeAward } from "./actions";

const SHOP_INVENTORY_STATES = shopInventory.input.shape.state.options;

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

// Only a date to come (an expiry) is written out; a past moment is a `RelativeTime`.
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
  const [t, locale, page] = await Promise.all([
    getTranslations("adminUsers.economy"),
    getLocale(),
    call(creditsLedger, { userId, cursor: cursorFrom(params, "ledger") }),
  ]);
  return (
    <PagedList
      items={page.items.map((row) => ({
        id: row.id,
        title: (
          <>
            <span
              className={`tabular-nums ${row.amount < 0 ? "text-destructive" : "text-success"}`}
            >
              {formatCredits(row.amount, locale, { signed: true })}
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
            {t("after", { balance: formatCredits(row.balanceAfter, locale) })} ·{" "}
            <RelativeTime date={row.createdAt} />
          </>
        ),
      }))}
      paging={{
        path: `/admin/users/${userId}/economy`,
        params,
        nextCursor: page.nextCursor,
        cursorParam: "ledger",
      }}
      label={t("ledger")}
      heading={t("ledger")}
      description={
        <>
          {t("balance")}{" "}
          <strong className="tabular-nums text-foreground">
            {formatCredits(page.balance ?? balance, locale)}
          </strong>
        </>
      }
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
    <details className="group min-w-0">
      <summary className="flex min-h-12 cursor-pointer items-center rounded-lg border bg-card px-4 text-sm font-semibold">
        {t("adjustHeading")}
      </summary>
      <div className="mt-4">
        <EditForm
          action={adjustCredits}
          submit={t("adjust")}
          disabled={readOnly}
        >
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
      </div>
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
    <PagedList
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
            {t("acquired")} <RelativeTime date={entry.acquiredAt} />
            {entry.expiresAt && (
              <>
                {" "}
                · {t("expires")} <Time at={entry.expiresAt} />
              </>
            )}
          </>
        ),
      }))}
      paging={{
        path: `/admin/users/${userId}/economy`,
        params,
        nextCursor: page.nextCursor,
        cursorParam: "inventory",
      }}
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
        <PagedList
          items={grants.items.map((grant) => ({
            id: grant.id,
            title: grant.award.name,
            badges: grant.award.category && (
              <Badge variant="secondary">{grant.award.category.title}</Badge>
            ),
            description: (
              <>
                <RelativeTime date={grant.grantedAt} /> ·{" "}
                {grant.grantedBy ? (
                  <>
                    {t("by")} <UserLink user={who(grant.grantedBy.id)} />
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
          paging={{
            path: `/admin/users/${userId}/economy`,
            params,
            nextCursor: grants.nextCursor,
            cursorParam: "awards",
          }}
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
