import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { LoadingRegion } from "@/components/forum/skeletons";
import { PageHeader } from "@/components/staff/page-header";
import { getViewer } from "@/lib/sermo/session";
import { PendingWork } from "../pending-work";
import { visibleSections } from "../registry";
import { ScreenCards } from "../section-landing";
import { PendingSkeleton } from "../skeletons";
import { staffTrail } from "../trail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.landing");
  return { title: t("metaTitle") };
}

// The moderation landing: the pending counts and the moderation screens the viewer may open, as the
// other sections' landings show theirs.
export default async function ModerationLanding() {
  const t = await getTranslations("moderation.landing");
  return (
    <div className="space-y-6">
      <PageHeader
        trail={staffTrail("/moderation")}
        title={t("heading")}
        description={t("subtitle")}
      />
      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingPending")}>
            <PendingSkeleton />
          </LoadingRegion>
        }
      >
        <PendingWork heading={false} />
      </Suspense>
      <Suspense>
        <Screens />
      </Suspense>
    </div>
  );
}

async function Screens() {
  const [viewer, t] = await Promise.all([
    getViewer(),
    getTranslations("moderation.landing"),
  ]);
  const screens =
    visibleSections(viewer).find((section) => section.id === "moderation")
      ?.screens ?? [];
  if (screens.length === 0) {
    return (
      <EmptyState
        title={t("screensEmpty")}
        description={t("screensEmptyDescription")}
        className="rounded-lg border bg-card"
      />
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{t("screensHeading")}</h2>
      <ScreenCards label={t("screensHeading")} screens={screens} />
    </section>
  );
}
