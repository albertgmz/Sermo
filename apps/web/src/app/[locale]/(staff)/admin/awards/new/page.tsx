import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EditForm } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../trail";
import { EditFormSkeleton } from "../../credits/skeletons";
import { saveAward } from "../actions";
import { AwardFormFields } from "../award-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.awards.new");
  return { title: t("metaTitle") };
}

export default function NewAwardPage() {
  const t = useTranslations("adminEconomy.awards");
  return (
    <ScreenFrame
      heading={t("new.heading")}
      subtitle={t("new.description")}
      trail={staffTrail("/admin/awards/new")}
      label={t("loading")}
      fallback={<EditFormSkeleton rows={7} advanced />}
    >
      <EditForm action={saveAward} submit={t("new.submit")}>
        <AwardFormFields />
      </EditForm>
    </ScreenFrame>
  );
}
