import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../trail";
import { FormSkeleton } from "../../groups/skeletons";
import { AnnouncementForm } from "./announcement-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.announcements");
  return { title: t("newMetaTitle") };
}

export default function NewAnnouncementPage() {
  const t = useTranslations("adminCommunication.announcements");
  return (
    <ScreenFrame
      heading={t("newHeading")}
      subtitle={t("newSubtitle")}
      trail={staffTrail("/admin/announcements/new")}
      label={t("loading")}
      fallback={<FormSkeleton rows={4} />}
    >
      <AnnouncementForm />
    </ScreenFrame>
  );
}
