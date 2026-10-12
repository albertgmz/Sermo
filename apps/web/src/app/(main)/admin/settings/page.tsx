import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DemoNotice } from "@/app/(main)/admin/demo-notice";
import { SettingsForm } from "@/app/(main)/admin/settings/settings-form";
import { SectionCard } from "@/components/forum/section-card";
import { getSite } from "@/lib/sermo/site";
import { getCurrentUser } from "@/lib/session";

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();
  const query = await searchParams;
  const [t, site] = await Promise.all([
    getTranslations("admin.settings"),
    getSite(),
  ]);

  return (
    <>
      {query.notice === "demo" && <DemoNotice />}
      <SectionCard title={t("title")} description={t("description")}>
        <SettingsForm siteName={site.name} />
      </SectionCard>
    </>
  );
}
