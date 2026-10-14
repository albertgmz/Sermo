import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { PendingWork } from "../pending-work";
import {
  ActivitySkeleton,
  JobsSkeleton,
  PendingSkeleton,
  SectionGridSkeleton,
  StaffSkeleton,
} from "../skeletons";
import { Activity, Jobs, SectionGrid, StaffOnline } from "./home-blocks";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.home");
  return { title: t("metaTitle") };
}

// The panel's home: pending work, the sections the viewer may open, and what the backend reports
// about activity, staff and background work, each block asked and shown on its own.
export default async function AdminHome() {
  const t = await getTranslations("admin.home");
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingPending")}>
            <PendingSkeleton />
          </LoadingRegion>
        }
      >
        <PendingWork />
      </Suspense>
      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingSections")}>
            <SectionGridSkeleton />
          </LoadingRegion>
        }
      >
        <SectionGrid />
      </Suspense>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingActivity")}>
              <ActivitySkeleton />
            </LoadingRegion>
          }
        >
          <Activity />
        </Suspense>
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingStaff")}>
              <StaffSkeleton />
            </LoadingRegion>
          }
        >
          <StaffOnline />
        </Suspense>
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingJobs")}>
              <JobsSkeleton />
            </LoadingRegion>
          }
        >
          <Jobs />
        </Suspense>
      </div>
    </div>
  );
}
