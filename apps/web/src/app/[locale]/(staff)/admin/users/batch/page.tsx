import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../trail";
import { FormSkeleton } from "../../groups/skeletons";
import { BatchScreen } from "./batch-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.batch");
  return { title: t("metaTitle") };
}

export default function BatchPage() {
  const t = useTranslations("adminUsers.batch");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/users/batch")}
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton rows={3} />}
    >
      <BatchScreen />
    </ScreenFrame>
  );
}
