import { BAN_STATES, bansList } from "@sermo/core/contracts";
import { User } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { cursorFrom } from "@/components/staff/cursor-list";
import { RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { PagedList } from "@/components/staff/paged-list";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { liftBan } from "../users/[id]/sanctions/actions";

type Params = Record<string, string | string[] | undefined>;

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
  const items = page.items.map((ban) => ({
    id: ban.id,
    icon: <UserAvatar user={who(ban.user.id)} size="lg" link={false} />,
    title: who(ban.user.id).username,
    href: `/admin/users/${ban.user.id}`,
    badges: (
      <Badge variant={ban.state === "active" ? "destructive" : "outline"}>
        {s(`banStates.${ban.state}`)}
      </Badge>
    ),
    description: (
      <>
        <span className="block">{ban.reason || t("noReason")}</span>
        <span className="flex flex-wrap items-center gap-x-3">
          <span>
            {t("by")}: <UserLink user={who(ban.moderator.id)} />
          </span>
          <span>
            {t("when")}:{" "}
            <time dateTime={ban.createdAt}>{date(ban.createdAt)}</time>
          </span>
          <span>
            {t("until")}:{" "}
            {ban.expiresAt ? (
              <time dateTime={ban.expiresAt}>{date(ban.expiresAt)}</time>
            ) : (
              t("permanent")
            )}
          </span>
        </span>
      </>
    ),
    actions: (
      <>
        <RowLink
          href={`/members/${ban.user.id}`}
          label={t("profile", { name: who(ban.user.id).username })}
          icon={<User />}
        />
        {ban.state === "active" && (
          <ConfirmStep
            action={liftBan}
            fields={{ banId: ban.id }}
            summary={t("lift")}
            reason={s("liftReason")}
            danger={false}
          />
        )}
      </>
    ),
  }));
  return (
    <>
      <Notice
        namespace="adminUsers.notices"
        searchParams={searchParams}
        shown={["lifted"]}
      />
      <PagedList
        items={items}
        paging={{ path: "/admin/bans", params, nextCursor: page.nextCursor }}
        label={t("heading")}
        empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
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
                className="inline-flex min-h-10 items-center px-2 text-sm text-primary-ink underline-offset-4 hover:underline"
              >
                {t("reset")}
              </Link>
            </div>
          </form>
        }
      />
    </>
  );
}
