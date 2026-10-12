import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, PageHead } from "../groups/skeletons";

export type Screen =
  | "general"
  | "members"
  | "warnings"
  | "uploads"
  | "seo"
  | "levels";

type Params = Promise<{ notice?: string | string[] }>;

// The confirmation a save redirected with, shown above the first panel.
export async function SettingsNotice({
  searchParams,
}: {
  searchParams: Params;
}) {
  const { notice } = await searchParams;
  if (notice !== "saved" && notice !== "added" && notice !== "deleted")
    return null;
  const t = await getTranslations("adminSetup.notices");
  return (
    <output className="block rounded-lg border bg-card px-4 py-2.5 text-xs font-medium text-success">
      {t(notice)}
    </output>
  );
}

// The frame of a settings screen: the heading at once, then the form once the settings are read.
export function SettingsScreen({
  screen,
  searchParams,
  children,
}: {
  screen: Screen;
  searchParams: Params;
  children: React.ReactNode;
}) {
  const t = useTranslations(`adminSetup.pages.${screen}`);
  const loading = useTranslations("adminSetup.loading");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={loading("label")}>
            <FormSkeleton />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <SettingsNotice searchParams={searchParams} />
          {children}
        </div>
      </Suspense>
    </div>
  );
}
