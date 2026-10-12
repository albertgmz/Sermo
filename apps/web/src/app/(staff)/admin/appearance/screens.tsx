import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, ListSkeleton, PageHead } from "../groups/skeletons";
import { CatalogScreen } from "./catalog-screen";
import type { ImageKind, PaletteKindName } from "./kinds";
import { IMAGE_KINDS, PALETTE_KINDS } from "./kinds";
import { PaletteScreen } from "./palette-screen";

type Search = Promise<{ notice?: string | string[] }>;

function Frame({
  heading,
  subtitle,
  loading,
  children,
}: {
  heading: string;
  subtitle: string;
  loading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHead heading={heading} subtitle={subtitle} />
      <Suspense
        fallback={
          <LoadingRegion label={loading}>
            <div className="space-y-4">
              <ListSkeleton />
              <FormSkeleton />
            </div>
          </LoadingRegion>
        }
      >
        <div className="space-y-4">{children}</div>
      </Suspense>
    </div>
  );
}

// The page of a picture catalog screen: heading at once, the catalog streaming in below it.
export function CatalogPage({
  kind,
  searchParams,
}: {
  kind: ImageKind;
  searchParams: Search;
}) {
  const t = useTranslations("adminAppearance.catalog");
  const key = IMAGE_KINDS[kind].key;
  return (
    <Frame
      heading={t(`${key}.pageHeading`)}
      subtitle={t(`${key}.subtitle`)}
      loading={t("loading")}
    >
      <CatalogScreen kind={kind} searchParams={searchParams} />
    </Frame>
  );
}

// The page of a colour palette screen.
export function PalettePage({
  kind,
  searchParams,
}: {
  kind: PaletteKindName;
  searchParams: Search;
}) {
  const t = useTranslations("adminAppearance.palette");
  const key = PALETTE_KINDS[kind].key;
  return (
    <Frame
      heading={t(`${key}.pageHeading`)}
      subtitle={t(`${key}.subtitle`)}
      loading={t("loading")}
    >
      <PaletteScreen kind={kind} searchParams={searchParams} />
    </Frame>
  );
}
