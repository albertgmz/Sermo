import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../../../trail";
import { FormSkeleton } from "../../../../groups/skeletons";
import { ActionForm, groupChoices } from "../../warning-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.warningActions.form");
  return { title: t("headingNew") };
}

async function NewAction() {
  return <ActionForm groups={await groupChoices()} />;
}

export default function NewWarningActionPage() {
  const t = useTranslations("adminSetup.warningActions.form");
  const loading = useTranslations("adminSetup.loading");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/settings/warnings/actions/new")}
      heading={t("headingNew")}
      subtitle={t("descriptionNew")}
      label={loading("label")}
      fallback={<FormSkeleton />}
    >
      <NewAction />
    </ScreenFrame>
  );
}
