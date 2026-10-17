import { ArrowUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { staffTrail } from "../../trail";
import { FormSkeleton, ListSkeleton } from "../groups/skeletons";
import { CatalogEdit, CatalogList, CatalogSort } from "./catalog-screen";
import type { ImageKind, PaletteKindName } from "./kinds";
import { IMAGE_KINDS, PALETTE_KINDS } from "./kinds";
import { PaletteEdit, PaletteList, PaletteSort } from "./palette-screen";

type Search = Promise<{ notice?: string | string[] }>;
type Params = Promise<{ id: string }>;

// The pages of the appearance screens. Each screen (a picture catalog or a colour palette) has the
// list, a page to add an entry, a page for each entry and a sort page; the address of the last
// three extends the list's. The heading and the trail show at once, the content streams in below.

// The list's primary actions: sort the entries, add one.
function ListActions({ path, add }: { path: string; add: string }) {
  const t = useTranslations("adminAppearance.page");
  const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");
  return (
    <>
      <Link href={`${path}/sort`} className={link}>
        <ArrowUpDown aria-hidden="true" />
        {t("sort")}
      </Link>
      <Link
        href={`${path}/new`}
        className={cn(buttonVariants(), "min-h-10 px-4")}
      >
        <Plus aria-hidden="true" />
        {add}
      </Link>
    </>
  );
}

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
      actions={<ListActions path={path} add={t(`${key}.add`)} />}
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

export function CatalogSortPage({ kind }: { kind: ImageKind }) {
  const t = useTranslations("adminAppearance.catalog");
  const { key, path } = IMAGE_KINDS[kind];
  return (
    <ScreenFrame
      trail={staffTrail(`${path}/sort`)}
      heading={t(`${key}.sortHeading`)}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <CatalogSort kind={kind} />
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
      actions={<ListActions path={path} add={t(`${key}.add`)} />}
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

export function PaletteSortPage({ kind }: { kind: PaletteKindName }) {
  const t = useTranslations("adminAppearance.palette");
  const { key, path } = PALETTE_KINDS[kind];
  return (
    <ScreenFrame
      trail={staffTrail(`${path}/sort`)}
      heading={t(`${key}.sortHeading`)}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <PaletteSort kind={kind} />
    </ScreenFrame>
  );
}
