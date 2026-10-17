import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { FormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { GroupForm } from "../group-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.new");
  return { title: t("metaTitle") };
}

export default function NewGroupPage() {
  const t = useTranslations("adminGroups.new");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/groups/new")}
      label={t("loading")}
      fallback={<FormSkeleton />}
    >
      <GroupForm />
    </ScreenFrame>
  );
}
