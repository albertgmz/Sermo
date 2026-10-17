import { ACCOUNT_STATES, usersAdminList } from "@sermo/core/contracts";
import { User } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { cursorFrom } from "@/components/staff/cursor-list";
import { RowLink } from "@/components/staff/item-list";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getGroups } from "../groups/data";
import { MemberState } from "./member-state";
import { PagedItems } from "./paged-items";

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

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
  const [t, states, groups, format, page] = await Promise.all([
    getTranslations("adminUsers.list"),
    getTranslations("adminUsers.states"),
    getGroups(),
    getFormatter(),
    read(usersAdminList, {
      state: stateFilter,
      groupId,
      prefix,
      cursor: cursorFrom(params),
    }),
  ]);
  const field = "grid min-w-0 gap-1.5 text-xs font-medium";
  const items = page.items.map((member) => {
    const { card } = member;
    return {
      id: card.id,
      icon: <UserAvatar user={card} size="lg" link={false} />,
      title: card.username,
      href: `/admin/users/${card.id}`,
      badges: (
        <>
          <MemberState state={member.state} />
          {card.badges.map((badge) => (
            <Badge key={badge.label} variant="outline">
              {badge.label}
            </Badge>
          ))}
        </>
      ),
      description: (
        <>
          <span className="block">{member.email}</span>
          <span className="flex flex-wrap gap-x-3">
            <span>
              {t("registered")}:{" "}
              <time dateTime={member.createdAt}>
                {format.dateTime(new Date(member.createdAt), {
                  dateStyle: "medium",
                })}
              </time>
            </span>
            <span>
              {t("lastSeen")}:{" "}
              {member.lastActivityAt ? (
                <RelativeTime date={member.lastActivityAt} />
              ) : (
                t("never")
              )}
            </span>
            <span className="tabular-nums">
              {t("posts")}: {format.number(member.postCount)}
            </span>
            <span className="tabular-nums">
              {t("credits")}: {format.number(member.credits)}
            </span>
          </span>
        </>
      ),
      actions: (
        <>
          <RowLink href={`/admin/users/${card.id}`} label={t("open")} />
          <RowLink
            href={`/members/${card.id}`}
            label={t("profile")}
            icon={<User />}
          />
        </>
      ),
    };
  });
  return (
    <PagedItems
      items={items}
      nextCursor={page.nextCursor}
      path="/admin/users"
      params={params}
      label={t("heading")}
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
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="submit" className="min-h-10 px-4">
              {t("apply")}
            </Button>
            <Link
              href="/admin/users"
              className="inline-flex min-h-10 items-center px-2 text-sm text-primary-ink underline-offset-4 hover:underline"
            >
              {t("reset")}
            </Link>
          </div>
        </form>
      }
    />
  );
}
