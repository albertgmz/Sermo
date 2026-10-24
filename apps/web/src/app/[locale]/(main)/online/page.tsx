import { ONLINE_TYPES, onlineList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { OnlineRow } from "@/app/[locale]/(main)/online/online-row";
import { TabLinks } from "@/components/forum/tab-links";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { NOINDEX } from "@/lib/sermo/seo";

type OnlineType = (typeof ONLINE_TYPES)[number];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members.online");
  // XenForo keeps the list of current visitors out of search engines.
  return { title: t("metaTitle"), robots: NOINDEX };
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// The address of a filter and page, as XenForo's: `/online?type=guest&page=2`.
function onlineHref(type: OnlineType, page = 1) {
  const query = new URLSearchParams();
  if (type !== "all") query.set("type", type);
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `/online?${search}` : "/online";
}

// XenForo's "Current visitors": every member seen in the last day and every guest and robot of the
// last hour, most recent first, with what each is viewing when the viewer may know it. A filter
// keeps members, guests or robots; the list is paged.
export default async function OnlinePage({
  searchParams,
}: PageProps<"/[locale]/online">) {
  const params = await searchParams;
  const raw = first(params.type);
  const type: OnlineType = ONLINE_TYPES.find((value) => value === raw) ?? "all";
  const asked = Number(first(params.page));
  const page =
    Number.isSafeInteger(asked) && asked >= 1 && asked <= 10_000 ? asked : 1;
  const [t, format, answer] = await Promise.all([
    getTranslations("members.online"),
    getFormatter(),
    read(onlineList, { type, page }),
  ]);
  const pages = Math.max(1, Math.ceil(answer.total / answer.perPage));
  return (
    <PageLayout mainClassName="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <section className="overflow-hidden rounded-lg border bg-card">
        <TabLinks
          label={t("aria.filter")}
          active={type}
          tabs={ONLINE_TYPES.map((value) => ({
            value,
            label: t(`tabs.${value}`),
            href: onlineHref(value),
          }))}
          className="px-2"
        />
        {answer.items.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {answer.items.map((visitor, index) => (
              <OnlineRow
                key={visitor.card?.id ?? `${page}-${index}`}
                visitor={visitor}
              />
            ))}
          </ol>
        )}
      </section>
      {pages > 1 && (
        <nav
          aria-label={t("aria.pages")}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-xs text-muted-foreground">
            {t("pagination", {
              page: format.number(page),
              pages: format.number(pages),
            })}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={onlineHref(type, Math.min(page, pages + 1) - 1)}
                className={buttonVariants({
                  variant: "outline",
                  className: "min-h-10",
                })}
              >
                {t("previous")}
              </Link>
            )}
            {page < pages && (
              <Link
                href={onlineHref(type, page + 1)}
                className={buttonVariants({
                  variant: "outline",
                  className: "min-h-10",
                })}
              >
                {t("next")}
              </Link>
            )}
          </div>
        </nav>
      )}
    </PageLayout>
  );
}
