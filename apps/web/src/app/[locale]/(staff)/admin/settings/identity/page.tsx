import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { FormSkeleton } from "../../groups/skeletons";
import { SettingsNotice } from "../settings-screen";
import { IdentityForm } from "./identity-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.identity");
  return { title: t("metaTitle") };
}

export default function IdentityPage({
  searchParams,
}: PageProps<"/[locale]/admin/settings/identity">) {
  const t = useTranslations("adminSetup.identity");
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton rows={3} />}
    >
      <SettingsNotice searchParams={searchParams} />
      <IdentityForm />
    </ScreenFrame>
  );
}
