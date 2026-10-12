import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { LoadingRegion } from "@/components/forum/skeletons";
import { getViewer } from "@/lib/sermo/session";
import { PendingWork } from "../pending-work";
import { visibleSections } from "../registry";
import { PendingSkeleton } from "../skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.landing");
  return { title: t("metaTitle") };
}

// The moderation landing: the pending counts and the moderation screens the viewer may open.
export default async function ModerationLanding() {
  const t = await getTranslations("moderation.landing");
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
        <PendingWork heading={false} />
      </Suspense>
      <Suspense>
        <Screens />
      </Suspense>
    </div>
  );
}

async function Screens() {
  const [viewer, t, registry] = await Promise.all([
    getViewer(),
    getTranslations("moderation.landing"),
    getTranslations("admin.registry"),
  ]);
  const screens = (
    visibleSections(viewer).find((section) => section.id === "moderation")
      ?.screens ?? []
  ).filter((screen) => screen.key !== "moderationHome");
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
      <ul className="grid gap-3 sm:grid-cols-2">
        {screens.map((screen) => (
          <li key={screen.key}>
            <Link
              href={screen.path}
              className="flex min-h-10 items-center rounded-lg border bg-card px-4 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {registry(`screens.${screen.key}`)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
