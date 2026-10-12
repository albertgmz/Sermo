import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { PageHead } from "../../groups/skeletons";
import { AnnouncementForm } from "./announcement-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.announcements");
  return { title: t("newMetaTitle") };
}

export default function NewAnnouncementPage() {
  const t = useTranslations("adminCommunication.announcements");
  return (
    <div className="space-y-6">
      <PageHead heading={t("newHeading")} subtitle={t("newSubtitle")} />
      <AnnouncementForm />
    </div>
  );
}
