import { signupsList } from "@sermo/core/contracts";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type * as z from "zod";
import { RelativeTime } from "@/components/forum/relative-time";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { linkClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor, type Standing } from "../../registry";
import { RESULT_KEYS } from "./result";
import { DecideControls } from "./signup-controls";
import { SignupSelection, SignupTick } from "./signup-selection";

type Params = PageProps<"/[locale]/moderation/signups">["searchParams"];
type Entry = z.output<typeof signupsList.output>["items"][number];

// The country as "Name (CC)", or the bare code when the runtime has no name for it.
function countryName(code: string, locale: string) {
  try {
    const name = new Intl.DisplayNames([locale], { type: "region" }).of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

// A member's name, a link to the panel's page of them when the viewer may open it.
function Name({
  viewer,
  member,
  className,
}: {
  viewer: Standing;
  member: { id: number; username: string };
  className?: string;
}) {
  const href = hrefFor(viewer, "usersEdit")?.replace("[id]", String(member.id));
  return href ? (
    <Link href={href} className={className ?? linkClass}>
      {member.username}
    </Link>
  ) : (
    <span className={className}>{member.username}</span>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 [overflow-wrap:anywhere]">
      <dt className="inline">{label}: </dt>
      <dd className="inline text-foreground">{children}</dd>
    </div>
  );
}

// One account waiting: who, what the spam check and the address log say, the terms it accepted,
// and what to do with it. Only what the backend returned is drawn: no address without the
// permission to see addresses, no country the log does not know.
function Row({
  entry,
  viewer,
  locale,
}: {
  entry: Entry;
  viewer: Standing;
  locale: string;
}) {
  const t = useTranslations("moderation.signups");
  const format = useFormatter();
  const { user, sharedAddress } = entry;
  const lookup = hrefFor(viewer, "moderationIps");
  return (
    <article className="flex gap-3 p-4">
      <SignupTick id={user.id} name={user.username} />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Name
            viewer={viewer}
            member={user}
            className="text-sm font-semibold [overflow-wrap:anywhere]"
          />
          {entry.flagged && <Badge variant="destructive">{t("flagged")}</Badge>}
        </p>
        <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
          <Fact label={t("email")}>{entry.email}</Fact>
          <Fact label={t("signedUp")}>
            <RelativeTime date={entry.createdAt} />
          </Fact>
          {entry.country && (
            <Fact label={t("country")}>
              {countryName(entry.country, locale)}
            </Fact>
          )}
          {entry.ip && (
            <Fact label={t("address")}>
              {lookup ? (
                <Link
                  href={`${lookup}?ip=${encodeURIComponent(entry.ip)}`}
                  className="text-primary-ink underline-offset-4 hover:underline"
                >
                  {entry.ip}
                </Link>
              ) : (
                entry.ip
              )}
            </Fact>
          )}
          {sharedAddress && sharedAddress.accounts > 0 && (
            <Fact label={t("sharedAddress")}>
              {t("sharedCount", {
                accounts: sharedAddress.accounts,
                banned: sharedAddress.banned,
              })}
              {sharedAddress.members.length > 0 && ": "}
              {sharedAddress.members.map((member, index) => (
                <span key={member.id}>
                  {index > 0 && ", "}
                  <Name
                    viewer={viewer}
                    member={member}
                    className="text-primary-ink underline-offset-4 hover:underline"
                  />
                </span>
              ))}
            </Fact>
          )}
          {entry.acceptances.length > 0 && (
            <Fact label={t("accepted")}>
              {entry.acceptances
                .map((item) =>
                  t("acceptedItem", {
                    kind: t(`kind.${item.kind}`),
                    version: item.version,
                    date: format.dateTime(new Date(item.acceptedAt), {
                      dateStyle: "medium",
                    }),
                  }),
                )
                .join("; ")}
            </Fact>
          )}
        </dl>
        <DecideControls userIds={[user.id]} />
      </div>
    </article>
  );
}

// The sign-up queue as the backend returns it, newest first. Each row carries everything the
// decision needs, so nothing is read per row.
export async function SignupList({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  // What the last decision left in the address is shown once: the paging links do not carry it.
  const paging = Object.fromEntries(
    Object.entries(params).filter(([key]) => !RESULT_KEYS.includes(key)),
  );
  const [t, viewer, locale, page] = await Promise.all([
    getTranslations("moderation.signups"),
    getViewer(),
    getLocale(),
    read(signupsList, { cursor: cursorFrom(params), limit: 20 }),
  ]);
  return (
    <SignupSelection pageIds={page.items.map((entry) => entry.user.id)}>
      <CursorList
        items={page.items}
        nextCursor={page.nextCursor}
        path="/moderation/signups"
        params={paging}
        itemKey={(entry) => entry.user.id}
        label={t("list")}
        empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
        render={(entry) => (
          <Row entry={entry} viewer={viewer} locale={locale} />
        )}
      />
    </SignupSelection>
  );
}
