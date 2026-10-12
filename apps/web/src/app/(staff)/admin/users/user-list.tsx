import { ACCOUNT_STATES, usersAdminList } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { selectClass } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { groupsIfAllowed } from "../groups/data";
import type { AdminMember } from "./data";
import { MemberState } from "./member-state";

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

const COLUMNS =
  "md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.8fr)_5.5rem_7.5rem_7rem_6rem_3.5rem_4.5rem]";

async function Row({ member }: { member: AdminMember }) {
  const [t, format] = await Promise.all([
    getTranslations("adminUsers.list"),
    getFormatter(),
  ]);
  const { card } = member;
  const cell = "min-w-0 text-sm [overflow-wrap:anywhere]";
  const label = "text-xs text-muted-foreground md:hidden";
  return (
    <div className={`grid gap-x-4 gap-y-2 p-4 md:items-center ${COLUMNS}`}>
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar user={card} size="lg" link={false} />
        <div className="min-w-0">
          <UserLink
            user={card}
            className="inline-flex min-h-10 items-center text-sm font-semibold"
          />
          <Link
            href={`/admin/users/${card.id}`}
            className="flex min-h-10 items-center text-xs text-primary underline-offset-4 hover:underline md:min-h-0"
          >
            {t("open")}
          </Link>
        </div>
      </div>
      <p className={cell}>
        <span className={label}>{t("email")}: </span>
        {member.email}
      </p>
      <p>
        <MemberState state={member.state} />
      </p>
      <p className={cell}>
        <span className={label}>{t("group")}: </span>
        {card.badges.map((badge) => badge.label).join(", ") || t("none")}
      </p>
      <p className={cell}>
        <span className={label}>{t("registered")}: </span>
        <time dateTime={member.createdAt}>
          {format.dateTime(new Date(member.createdAt), { dateStyle: "medium" })}
        </time>
      </p>
      <p className={cell}>
        <span className={label}>{t("lastSeen")}: </span>
        {member.lastActivityAt ? (
          <RelativeTime date={member.lastActivityAt} />
        ) : (
          t("never")
        )}
      </p>
      <p className={`${cell} tabular-nums`}>
        <span className={label}>{t("posts")}: </span>
        {format.number(member.postCount)}
      </p>
      <p className={`${cell} tabular-nums`}>
        <span className={label}>{t("credits")}: </span>
        {format.number(member.credits)}
      </p>
    </div>
  );
}

// Every member through `users.adminList`, with the filters in the address. A page may be short
// or empty while there is a next cursor: "Next" is offered whenever the backend gives one.
export async function UserList({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const state = one(params.state);
  const stateFilter = (ACCOUNT_STATES as readonly string[]).includes(state)
    ? (state as (typeof ACCOUNT_STATES)[number])
    : undefined;
  const groupId = parseId(one(params.group)) ?? undefined;
  const prefix = one(params.q).trim().slice(0, 64) || undefined;
  const [t, states, groups, page] = await Promise.all([
    getTranslations("adminUsers.list"),
    getTranslations("adminUsers.states"),
    groupsIfAllowed(),
    read(usersAdminList, {
      state: stateFilter,
      groupId,
      prefix,
      cursor: cursorFrom(params),
    }),
  ]);
  const field = "grid min-w-0 gap-1.5 text-xs font-medium";
  return (
    <CursorList
      items={page.items}
      nextCursor={page.nextCursor}
      path="/admin/users"
      params={params}
      itemKey={(member) => member.card.id}
      render={(member) => <Row member={member} />}
      label={t("heading")}
      head={
        <div
          className={`hidden gap-x-4 border-b px-4 py-2 text-xs font-semibold text-muted-foreground md:grid ${COLUMNS}`}
        >
          <span>{t("member")}</span>
          <span>{t("email")}</span>
          <span>{t("state")}</span>
          <span>{t("group")}</span>
          <span>{t("registered")}</span>
          <span>{t("lastSeen")}</span>
          <span>{t("posts")}</span>
          <span>{t("credits")}</span>
        </div>
      }
      empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      filters={
        <form method="get" action="/admin/users" aria-label={t("filters")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label htmlFor="users-prefix" className={field}>
              {t("prefix")}
              <Input
                id="users-prefix"
                type="search"
                name="q"
                maxLength={64}
                defaultValue={prefix}
              />
              <span className="font-normal text-muted-foreground">
                {t("prefixHelp")}
              </span>
            </label>
            <label className={field}>
              {t("state")}
              <select
                name="state"
                defaultValue={stateFilter ?? ""}
                className={selectClass}
              >
                <option value="">{t("all")}</option>
                {ACCOUNT_STATES.map((value) => (
                  <option key={value} value={value}>
                    {states(value)}
                  </option>
                ))}
              </select>
            </label>
            {groups && (
              <label className={field}>
                {t("group")}
                <select
                  name="group"
                  defaultValue={groupId ?? ""}
                  className={selectClass}
                >
                  <option value="">{t("all")}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="submit" className="min-h-10 px-4">
              {t("apply")}
            </Button>
            <Link
              href="/admin/users"
              className="inline-flex min-h-10 items-center px-2 text-sm text-primary underline-offset-4 hover:underline"
            >
              {t("reset")}
            </Link>
          </div>
        </form>
      }
    />
  );
}
