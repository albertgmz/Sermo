import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EditForm } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../trail";
import { FormSkeleton } from "../../groups/skeletons";
import { createNotice } from "../actions";
import { NoticeFields } from "../notice-fields";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.notices.create");
  return { title: t("metaTitle") };
}

export default function NewNoticePage() {
  const t = useTranslations("adminCommunication.notices");
  return (
    <ScreenFrame
      heading={t("create.heading")}
      subtitle={t("create.description")}
      trail={staffTrail("/admin/notices/new")}
      label={t("loading")}
      fallback={<FormSkeleton rows={5} />}
    >
      <EditForm action={createNotice} submit={t("create.submit")}>
        <NoticeFields prefix="new-notice" />
      </EditForm>
    </ScreenFrame>
  );
}
