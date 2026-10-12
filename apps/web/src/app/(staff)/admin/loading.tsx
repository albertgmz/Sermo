import { useTranslations } from "next-intl";
import { LoadingRegion } from "@/components/forum/skeletons";
import {
  ActivitySkeleton,
  HeadingSkeleton,
  JobsSkeleton,
  PendingSkeleton,
  SectionGridSkeleton,
  StaffSkeleton,
} from "../skeletons";

export default function Loading() {
  const t = useTranslations("admin.shell");
  return (
    <LoadingRegion label={t("aria.loadingPage")}>
      <div className="space-y-6">
        <HeadingSkeleton />
        <PendingSkeleton />
        <SectionGridSkeleton />
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <ActivitySkeleton />
          <StaffSkeleton />
          <JobsSkeleton />
        </div>
      </div>
    </LoadingRegion>
  );
}
