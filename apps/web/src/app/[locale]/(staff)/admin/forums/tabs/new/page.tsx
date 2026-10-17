import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { FormSkeleton } from "../../../../skeletons";
import { staffTrail } from "../../../../trail";
import { TabForm } from "../tab-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.tabForm");
  return { title: t("metaTitleNew") };
}

export default function NewTabPage() {
  const t = useTranslations("adminForums.tabForm");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/forums/tabs/new")}
      heading={t("pageHeadingNew")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton rows={2} />}
    >
      <TabForm />
    </ScreenFrame>
  );
}
