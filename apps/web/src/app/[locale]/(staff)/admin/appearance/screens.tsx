import { useTranslations } from "next-intl";
import { AddLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { FormSkeleton, ListSkeleton } from "../groups/skeletons";
import { CatalogEdit, CatalogList } from "./catalog-screen";
import type { ImageKind, PaletteKindName } from "./kinds";
import { IMAGE_KINDS, PALETTE_KINDS } from "./kinds";
import { PaletteEdit, PaletteList } from "./palette-screen";

type Search = Promise<{ notice?: string | string[] }>;
type Params = Promise<{ id: string }>;

// The pages of the appearance screens. Each screen (a picture catalog or a colour palette) has the
// list, a page to add an entry and a page for each entry; the address of the last two extends
// the list's. The heading and the trail show at once, the content streams in below.

// The trail of an entry's page: the address names the entry.
async function entryTrail(path: string, params: Params) {
  const { id } = await params;
  return staffTrail(`${path}/${id}`);
}

export function CatalogPage({
  kind,
  searchParams,
}: {
  kind: ImageKind;
  searchParams: Search;
}) {
  const t = useTranslations("adminAppearance.catalog");
  const { key, path } = IMAGE_KINDS[kind];
  return (
    <ScreenFrame
      trail={staffTrail(path)}
      heading={t(`${key}.pageHeading`)}
      subtitle={t(`${key}.subtitle`)}
      actions={<AddLink href={`${path}/new`}>{t(`${key}.add`)}</AddLink>}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <CatalogList kind={kind} searchParams={searchParams} />
    </ScreenFrame>
  );
}

// The page of a new entry (no `params`) or of the entry the address names.
export function CatalogEditPage({
  kind,
  params,
}: {
  kind: ImageKind;
  params?: Params;
}) {
  const t = useTranslations("adminAppearance.catalog");
  const f = useTranslations("adminAppearance.entryForm");
  const { key, path } = IMAGE_KINDS[kind];
  return (
    <ScreenFrame
      trail={params ? entryTrail(path, params) : staffTrail(`${path}/new`)}
      heading={params ? t(`${key}.editHeading`) : t(`${key}.newHeading`)}
      subtitle={params ? undefined : f(`descriptionNew.${key}`)}
      label={t("loading")}
      fallback={<FormSkeleton />}
    >
      <CatalogEdit kind={kind} params={params} />
    </ScreenFrame>
  );
}

export function PalettePage({
  kind,
  searchParams,
}: {
  kind: PaletteKindName;
  searchParams: Search;
}) {
  const t = useTranslations("adminAppearance.palette");
  const { key, path } = PALETTE_KINDS[kind];
  return (
    <ScreenFrame
      trail={staffTrail(path)}
      heading={t(`${key}.pageHeading`)}
      subtitle={t(`${key}.subtitle`)}
      actions={<AddLink href={`${path}/new`}>{t(`${key}.add`)}</AddLink>}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <PaletteList kind={kind} searchParams={searchParams} />
    </ScreenFrame>
  );
}

// The page of a new colour (no `params`) or of the colour the address names.
export function PaletteEditPage({
  kind,
  params,
}: {
  kind: PaletteKindName;
  params?: Params;
}) {
  const t = useTranslations("adminAppearance.palette");
  const f = useTranslations("adminAppearance.colourForm");
  const { key, path } = PALETTE_KINDS[kind];
  return (
    <ScreenFrame
      trail={params ? entryTrail(path, params) : staffTrail(`${path}/new`)}
      heading={params ? t(`${key}.editHeading`) : t(`${key}.newHeading`)}
      subtitle={params ? undefined : f(`descriptionNew.${kind}`)}
      label={t("loading")}
      fallback={<FormSkeleton />}
    >
      <PaletteEdit kind={kind} params={params} />
    </ScreenFrame>
  );
}
