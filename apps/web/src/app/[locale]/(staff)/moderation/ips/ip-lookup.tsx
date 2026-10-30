import { ipsMembers, usersIps } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { cursorFrom } from "@/components/staff/cursor-list";
import { PagedList } from "@/components/staff/paged-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { MemberLink, memberNames, panelHref } from "../../admin/logs/links";

type Params = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

// The two questions staff ask of the IP log. `?ip=` lists the members who used an address (an
// IPv6 address stands for its /64); `?member=` lists the addresses one member used, each linking
// to the first view. Both page by cursor in the address.
export async function IpLookup({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const ip = one(params.ip).trim().slice(0, 64);
  const memberId = parseId(one(params.member));
  const [t, viewer] = await Promise.all([
    getTranslations("moderation.ips"),
    getViewer(),
  ]);
  const seen = (first: string, last: string) => (
    <>
      <p className="text-xs text-muted-foreground">
        {t("firstSeen")} <RelativeTime date={first} />
      </p>
      <p className="text-xs text-muted-foreground">
        {t("lastSeen")} <RelativeTime date={last} />
      </p>
    </>
  );
  const form = (
    <form method="get" action="/moderation/ips" aria-label={t("filters")}>
      <label
        htmlFor="ips-address"
        className="grid min-w-0 gap-1.5 text-xs font-medium"
      >
        {t("address")}
        <Input
          id="ips-address"
          type="search"
          name="ip"
          defaultValue={ip}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="font-normal text-muted-foreground">
          {t("addressHelp")}
        </span>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" className="min-h-10 px-4">
          {t("lookup")}
        </Button>
        <Link
          href="/moderation/ips"
          className="inline-flex min-h-10 items-center px-2 text-sm text-primary-ink underline-offset-4 hover:underline"
        >
          {t("reset")}
        </Link>
      </div>
    </form>
  );
  const withHeading = (heading: string) => (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold [overflow-wrap:anywhere]">
        {heading}
      </h2>
      {form}
    </div>
  );

  if (memberId !== null && !ip) {
    const [page, name] = await Promise.all([
      call(usersIps, { userId: memberId, cursor: cursorFrom(params) }).catch(
        (error) => {
          // A member of equal or higher rank, or none at all: shown as refused, not as an error.
          if (
            error instanceof SermoError &&
            (error.code === "forbidden" || error.code === "not_found")
          ) {
            return null;
          }
          throw error;
        },
      ),
      memberNames([memberId]),
    ]);
    if (!page) {
      return (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          {form}
          <p role="alert" className="text-xs font-medium text-destructive">
            {t("memberRefused")}
          </p>
        </section>
      );
    }
    const heading = t("memberHeading", { name: name(memberId) });
    return (
      <PagedList
        items={page.items.map((item) => ({
          id: item.ip,
          title: item.ip,
          href: `/moderation/ips?ip=${encodeURIComponent(item.ip)}`,
          description: (
            <>
              <p>
                {t("times", { count: item.count })}
                {item.network !== item.ip &&
                  ` · ${t("network", { network: item.network })}`}
              </p>
              {seen(item.firstSeenAt, item.lastSeenAt)}
            </>
          ),
        }))}
        paging={{
          path: "/moderation/ips",
          params,
          nextCursor: page.nextCursor,
        }}
        label={heading}
        filters={withHeading(heading)}
        empty={{
          title: t("memberEmptyTitle"),
          description: t("memberEmptyDescription"),
        }}
      />
    );
  }

  if (!ip) {
    return <section className="rounded-lg border bg-card p-4">{form}</section>;
  }

  let page: Awaited<ReturnType<typeof callMembers>>;
  try {
    page = await callMembers(ip, cursorFrom(params));
  } catch (error) {
    // The backend's word for a value that is not an address.
    if (!(error instanceof SermoError && error.code === "validation")) {
      throw error;
    }
    return (
      <section className="space-y-3 rounded-lg border bg-card p-4">
        {form}
        <p role="alert" className="text-xs font-medium text-destructive">
          {t("invalid")}
        </p>
      </section>
    );
  }
  const heading = t("membersHeading", { network: page.network });
  return (
    <PagedList
      items={page.items.map((item) => ({
        id: item.user.id,
        title: (
          <MemberLink
            id={item.user.id}
            name={item.user.username}
            panel={panelHref(viewer, "usersEdit", item.user.id)}
          />
        ),
        description: (
          <>
            <p>
              {t("times", { count: item.count })}
              {" · "}
              <Link
                href={`/moderation/ips?member=${item.user.id}`}
                className="text-primary-ink underline-offset-4 hover:underline"
              >
                {t("allAddresses")}
              </Link>
            </p>
            {seen(item.firstSeenAt, item.lastSeenAt)}
          </>
        ),
      }))}
      paging={{ path: "/moderation/ips", params, nextCursor: page.nextCursor }}
      label={heading}
      filters={withHeading(heading)}
      empty={{
        title: t("membersEmptyTitle"),
        description: t("membersEmptyDescription"),
      }}
    />
  );
}

const callMembers = (ip: string, cursor: string | undefined) =>
  call(ipsMembers, { ip, cursor });
