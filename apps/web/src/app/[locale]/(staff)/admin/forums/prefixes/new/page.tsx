import { paletteColorsList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { FormSkeleton } from "../../../../skeletons";
import { PrefixForm } from "../prefix-form";
import { prefixTrail } from "../prefix-trail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.prefixForm");
  return { title: t("metaTitleNew") };
}

async function NewPrefix() {
  const { items } = await read(paletteColorsList, { kind: "prefix" });
  return <PrefixForm colours={items} />;
}

export default function NewPrefixPage() {
  const t = useTranslations("adminForums.prefixForm");
  return (
    <ScreenFrame
      trail={prefixTrail("/admin/forums/prefixes/new")}
      heading={t("pageHeadingNew")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton rows={5} />}
    >
      <NewPrefix />
    </ScreenFrame>
  );
}
