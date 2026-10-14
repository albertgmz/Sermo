import { LiteSettingsSkeleton } from "@/app/[locale]/(main)/lite/settings-skeleton";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  return (
    <PageLayout>
      <LiteSettingsSkeleton />
    </PageLayout>
  );
}
