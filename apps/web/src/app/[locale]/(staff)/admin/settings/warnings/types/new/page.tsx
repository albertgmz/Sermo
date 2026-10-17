import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../../../trail";
import { FormSkeleton } from "../../../../groups/skeletons";
import { TypeForm } from "../../warning-types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.warningTypes.form");
  return { title: t("headingNew") };
}

export default function NewWarningTypePage() {
  const t = useTranslations("adminSetup.warningTypes.form");
  const loading = useTranslations("adminSetup.loading");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/settings/warnings/types/new")}
      heading={t("headingNew")}
      subtitle={t("descriptionNew")}
      label={loading("label")}
      fallback={<FormSkeleton />}
    >
      <TypeForm />
    </ScreenFrame>
  );
}
