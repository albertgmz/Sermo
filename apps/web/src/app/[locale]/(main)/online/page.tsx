import { ONLINE_TYPES, onlineList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  OnlineRegion,
  type OnlineType,
} from "@/app/[locale]/(main)/online/online-list";
import { onlinePage } from "@/app/[locale]/(main)/online/online-page";
import { PageSwitch } from "@/components/forum/page-switch";
import { TabLinks } from "@/components/forum/tab-links";
import { PageLayout } from "@/components/layout/page-layout";
import { read } from "@/lib/sermo/client";
import { NOINDEX } from "@/lib/sermo/seo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members.online");
  // XenForo keeps the list of current visitors out of search engines.
  return { title: t("metaTitle"), robots: NOINDEX };
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// The address of a filter, as XenForo's: `/online?type=guest` (its pages add `&page=2`).
const onlineHref = (type: OnlineType) =>
  type === "all" ? "/online" : `/online?type=${type}`;

// XenForo's "Current visitors": every member seen in the last day and every guest and robot of the
// last hour, most recent first, with what each is viewing when the viewer may know it. A filter
// keeps members, guests or robots; the list is paged with the shared pager, its pages changed in
// place.
export default async function OnlinePage({
  searchParams,
}: PageProps<"/[locale]/online">) {
  const params = await searchParams;
  const raw = first(params.type);
  const type: OnlineType = ONLINE_TYPES.find((value) => value === raw) ?? "all";
  const asked = Number(first(params.page));
  const page =
    Number.isSafeInteger(asked) && asked >= 1 && asked <= 10_000 ? asked : 1;
  const [t, answer] = await Promise.all([
    getTranslations("members.online"),
    read(onlineList, { type, page }),
  ]);
  return (
    <PageLayout mainClassName="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <TabLinks
        label={t("aria.filter")}
        active={type}
        tabs={ONLINE_TYPES.map((value) => ({
          value,
          label: t(`tabs.${value}`),
          href: onlineHref(value),
        }))}
      />
      <PageSwitch
        page={page}
        stamp={Date.now()}
        load={onlinePage.bind(null, type)}
      >
        <OnlineRegion type={type} answer={answer} />
      </PageSwitch>
    </PageLayout>
  );
}
