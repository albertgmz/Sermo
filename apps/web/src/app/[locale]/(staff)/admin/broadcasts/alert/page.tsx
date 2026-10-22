import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { FormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { BroadcastScreen } from "../broadcast-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.broadcasts");
  return { title: t("alertMeta") };
}

export default function BroadcastAlertPage() {
  const t = useTranslations("adminCommunication.broadcasts");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/broadcasts/alert")}
      heading={t("alertHeading")}
      subtitle={t("alertSubtitle")}
      label={t("loading")}
      fallback={<FormSkeleton rows={4} />}
    >
      <BroadcastScreen kind="alert" />
    </ScreenFrame>
  );
}
