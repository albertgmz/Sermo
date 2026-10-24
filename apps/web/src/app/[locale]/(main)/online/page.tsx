import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { onlineSection } from "@/app/[locale]/(main)/online/online-page";
import {
  ONLINE_SWITCH_PARAMS,
  OnlineSection,
} from "@/app/[locale]/(main)/online/online-section";
import { placeOfQuery } from "@/components/forum/places";
import { TabSwitch } from "@/components/forum/tab-switch";
import { PageLayout } from "@/components/layout/page-layout";
import { read } from "@/lib/sermo/client";
import { NOINDEX } from "@/lib/sermo/seo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members.online");
  // XenForo keeps the list of current visitors out of search engines.
  return { title: t("metaTitle"), robots: NOINDEX };
}

// XenForo's "Current visitors": every member seen in the last day and every guest and robot of the
// last hour, most recent first, with what each is viewing when the viewer may know it. A filter
// keeps members, guests or robots, changed in place (`TabSwitch`); the list is paged with the
// shared pager, its pages changed in place too.
export default async function OnlinePage({
  searchParams,
}: PageProps<"/[locale]/online">) {
  const params = await searchParams;
  const [t, section] = await Promise.all([
    getTranslations("members.online"),
    OnlineSection({ query: params, reader: read }),
  ]);
  return (
    <PageLayout mainClassName="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <TabSwitch
        place={placeOfQuery(params, ONLINE_SWITCH_PARAMS)}
        params={ONLINE_SWITCH_PARAMS}
        stamp={Date.now()}
        load={onlineSection}
        className="space-y-4"
      >
        {section}
      </TabSwitch>
    </PageLayout>
  );
}
