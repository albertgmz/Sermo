import { LiteSettingsSkeleton } from "@/app/[locale]/(main)/data-saver/settings-skeleton";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  return (
    <PageLayout>
      <LiteSettingsSkeleton />
    </PageLayout>
  );
}
