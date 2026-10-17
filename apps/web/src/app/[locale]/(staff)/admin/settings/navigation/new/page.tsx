import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { FormSkeleton } from "../../../groups/skeletons";
import { getEntries, globalPermissions } from "../data";
import { EntryForm } from "../entry-form";
import { navigationTrail } from "../navigation-trail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.navigation.new");
  return { title: t("metaTitle") };
}

async function NewEntry() {
  const [entries, permissions] = await Promise.all([
    getEntries(),
    globalPermissions(),
  ]);
  return <EntryForm entries={entries} permissions={permissions} />;
}

export default function NewEntryPage() {
  const t = useTranslations("adminSetup.navigation.new");
  const page = useTranslations("adminSetup.pages.navigation");
  return (
    <ScreenFrame
      trail={navigationTrail("/admin/settings/navigation/new")}
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={page("loading")}
      fallback={<FormSkeleton />}
    >
      <NewEntry />
    </ScreenFrame>
  );
}
