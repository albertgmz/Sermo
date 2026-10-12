import { BAN_STATES, bansList } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { UserLink } from "@/components/forum/user-link";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { liftBan } from "../users/[id]/sanctions/actions";
import { InlineAction } from "../users/inline-action";
import { Notice } from "../users/notice";

type Params = Record<string, string | string[] | undefined>;

const COLUMNS =
  "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_8rem_8rem_6rem]";

// The ban register, newest first, with the state filter in the address.
export async function BanList({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const raw = params.state;
  const state = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const chosen = (BAN_STATES as readonly string[]).includes(state)
    ? (state as (typeof BAN_STATES)[number])
    : undefined;
  const [t, s, format, page] = await Promise.all([
    getTranslations("adminUsers.bans"),
    getTranslations("adminUsers.sanctions"),
    getFormatter(),
    read(bansList, { state: chosen, cursor: cursorFrom(params) }),
  ]);
  const who = await membersFor(
    page.items.flatMap((ban) => [ban.user, ban.moderator]),
  );
  const date = (at: string) =>
    format.dateTime(new Date(at), { dateStyle: "medium" });
  const label = "text-xs text-muted-foreground md:hidden";
  return (
    <>
      <Notice searchParams={searchParams} shown={["lifted"]} />
      <CursorList
        items={page.items}
        nextCursor={page.nextCursor}
        path="/admin/bans"
        params={params}
        itemKey={(ban) => ban.id}
        label={t("heading")}
        filters={
          <form method="get" action="/admin/bans" aria-label={t("filters")}>
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5 text-xs font-medium">
                {t("state")}
                <select
                  name="state"
                  defaultValue={chosen ?? ""}
                  className={`${selectClass} sm:w-48`}
                >
                  <option value="">{t("all")}</option>
                  {BAN_STATES.map((value) => (
                    <option key={value} value={value}>
                      {s(`banStates.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" className="min-h-10 px-4">
                {t("apply")}
              </Button>
              <Link
                href="/admin/bans"
                className="inline-flex min-h-10 items-center px-2 text-sm text-primary underline-offset-4 hover:underline"
              >
                {t("reset")}
              </Link>
            </div>
          </form>
        }
        head={
          <div
            className={`hidden gap-x-4 border-b px-4 py-2 text-xs font-semibold text-muted-foreground md:grid ${COLUMNS}`}
          >
            <span>{t("member")}</span>
            <span>{t("by")}</span>
            <span>{t("reason")}</span>
            <span>{t("when")}</span>
            <span>{t("until")}</span>
            <span>{t("state")}</span>
          </div>
        }
        empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
        render={(ban) => (
          <div className="space-y-2 p-4">
            <div
              className={`grid gap-x-4 gap-y-1.5 text-sm md:items-start ${COLUMNS}`}
            >
              <p className="min-w-0 font-medium [overflow-wrap:anywhere]">
                <UserLink
                  user={who(ban.user.id)}
                  className="inline-flex min-h-10 items-center"
                />
              </p>
              <p className="min-w-0 [overflow-wrap:anywhere]">
                <span className={label}>{t("by")}: </span>
                <UserLink
                  user={who(ban.moderator.id)}
                  className="inline-flex min-h-10 items-center"
                />
              </p>
              <p className="min-w-0 [overflow-wrap:anywhere]">
                <span className={label}>{t("reason")}: </span>
                {ban.reason || t("noReason")}
              </p>
              <p>
                <span className={label}>{t("when")}: </span>
                <time dateTime={ban.createdAt}>{date(ban.createdAt)}</time>
              </p>
              <p>
                <span className={label}>{t("until")}: </span>
                {ban.expiresAt ? (
                  <time dateTime={ban.expiresAt}>{date(ban.expiresAt)}</time>
                ) : (
                  t("permanent")
                )}
              </p>
              <p>
                <Badge
                  variant={ban.state === "active" ? "destructive" : "outline"}
                >
                  {s(`banStates.${ban.state}`)}
                </Badge>
              </p>
            </div>
            {ban.state === "active" && (
              <InlineAction
                action={liftBan}
                fields={{ banId: ban.id }}
                label={t("lift")}
                reason={s("liftReason")}
                danger={false}
              />
            )}
          </div>
        )}
      />
    </>
  );
}
