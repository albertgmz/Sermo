import { paletteColorsList, threadPrefixesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { FormSkeleton } from "../../../../skeletons";
import { PrefixForm } from "../prefix-form";
import { prefixTrail } from "../prefix-trail";
import Loading from "./loading";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.prefixForm");
  return { title: t("metaTitleEdit") };
}

type Props = PageProps<"/[locale]/admin/forums/prefixes/[id]">;

// The backend has no read of one prefix: it is found in the list.
async function EditPrefix({ params }: Pick<Props, "params">) {
  const prefixId = parseId((await params).id);
  if (prefixId === null) notFound();
  const [t, { items }, { items: colours }] = await Promise.all([
    getTranslations("adminForums.prefixForm"),
    read(threadPrefixesList, {}),
    read(paletteColorsList, { kind: "prefix" }),
  ]);
  const prefix = items.find((item) => item.id === prefixId);
  if (!prefix) notFound();
  return (
    <ScreenFrame
      trail={prefixTrail(`/admin/forums/prefixes/${prefix.id}`)}
      heading={t("pageHeadingEdit")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton rows={5} />}
    >
      <PrefixForm prefix={prefix} colours={colours} />
    </ScreenFrame>
  );
}

export default function EditPrefixPage({ params }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <EditPrefix params={params} />
    </Suspense>
  );
}
