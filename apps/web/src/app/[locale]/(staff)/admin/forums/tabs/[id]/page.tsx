import { forumTabsList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { FormSkeleton } from "../../../../skeletons";
import { staffTrail } from "../../../../trail";
import { TabForm } from "../tab-form";
import Loading from "./loading";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.tabForm");
  return { title: t("metaTitleEdit") };
}

type Props = PageProps<"/[locale]/admin/forums/tabs/[id]">;

// The backend has no read of one tab: it is found in the list.
async function EditTab({ params }: Pick<Props, "params">) {
  const tabId = parseId((await params).id);
  if (tabId === null) notFound();
  const [t, { items }] = await Promise.all([
    getTranslations("adminForums.tabForm"),
    read(forumTabsList, {}),
  ]);
  const tab = items.find((item) => item.id === tabId);
  if (!tab) notFound();
  return (
    <ScreenFrame
      trail={staffTrail(`/admin/forums/tabs/${tab.id}`)}
      heading={t("pageHeadingEdit")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton rows={2} />}
    >
      <TabForm tab={tab} />
    </ScreenFrame>
  );
}

export default function EditTabPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <EditTab params={params} />
    </Suspense>
  );
}
