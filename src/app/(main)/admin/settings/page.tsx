import { notFound } from "next/navigation";
import { DemoNotice } from "@/app/(main)/admin/demo-notice";
import { SettingsForm } from "@/app/(main)/admin/settings/settings-form";
import { SectionCard } from "@/components/forum/section-card";
import { getCurrentUser } from "@/lib/session";

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();
  const query = await searchParams;

  return (
    <>
      {query.notice === "demo" && <DemoNotice />}
      <SectionCard
        title="General settings"
        description="Try these example options for your community."
      >
        <SettingsForm />
      </SectionCard>
    </>
  );
}
