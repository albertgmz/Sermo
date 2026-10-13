import { useTranslations } from "next-intl";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
import { CatalogScreen } from "./catalog-screen";
import type { ImageKind, PaletteKindName } from "./kinds";
import { IMAGE_KINDS, PALETTE_KINDS } from "./kinds";
import { PaletteScreen } from "./palette-screen";

type Search = Promise<{ notice?: string | string[] }>;

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
    <ScreenFrame
      heading={t(`${key}.pageHeading`)}
      subtitle={t(`${key}.subtitle`)}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <CatalogScreen kind={kind} searchParams={searchParams} />
    </ScreenFrame>
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
    <ScreenFrame
      heading={t(`${key}.pageHeading`)}
      subtitle={t(`${key}.subtitle`)}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <PaletteScreen kind={kind} searchParams={searchParams} />
    </ScreenFrame>
  );
}
