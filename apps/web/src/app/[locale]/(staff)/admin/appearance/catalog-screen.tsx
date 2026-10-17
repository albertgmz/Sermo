import { catalogImagesList, filesGet } from "@sermo/core/contracts";
import { ImageOff } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Art } from "@/components/forum/art";
import { EmptyState } from "@/components/forum/empty-state";
import { UserAvatar } from "@/components/forum/user-avatar";
import { ConfirmStep } from "@/components/staff/confirm-step";
import {
  Advanced,
  EditForm,
  Field,
  FieldGroup,
} from "@/components/staff/edit-form";
import { ItemList, RowLink, RowToggle } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { PictureField } from "@/components/staff/picture-field";
import { SortForm } from "@/components/staff/sort-form";
import { Badge } from "@/components/ui/badge";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import {
  deleteImage,
  saveImage,
  saveImageOrder,
  setImageActive,
} from "./actions";
import { ActiveField, NameField, PositionField } from "./entry-fields";
import { IMAGE_KINDS, type ImageKind } from "./kinds";
import { PlacementEditor } from "./placement-editor";

type Entry = z.output<typeof catalogImagesList.output>["items"][number];

// A catalog holds at most 500 entries and the backend does not page it: its entries in display
// order, inactive ones and ones waiting for a picture too.
const readCatalog = (kind: ImageKind) => read(catalogImagesList, { kind });

// The picture of an entry as members get it: a frame around a sample avatar, drawn by the public
// site's own avatar, or a cover in a box. Both go through the LITE gates. `compact` is the small
// picture of a row; without it, the full-size one of the edit page.
async function Picture({
  kind,
  entry,
  compact,
}: {
  kind: ImageKind;
  entry: Entry;
  compact?: boolean;
}) {
  const t = await getTranslations("adminAppearance.catalog");
  if (!entry.image) {
    return compact ? (
      <ImageOff
        role="img"
        aria-label={t("noPicture")}
        className="size-5 text-muted-foreground"
      />
    ) : (
      <span className="flex size-24 items-center justify-center rounded-lg border border-dashed p-2 text-center text-xs text-muted-foreground">
        {t("noPicture")}
      </span>
    );
  }
  if (kind === "frame") {
    const avatar = (
      <UserAvatar
        user={{
          username: t("sample"),
          avatar: null,
          frame: entry.placement
            ? { url: entry.image.url, placement: entry.placement }
            : null,
        }}
        size={compact ? "md" : "2xl"}
        link={false}
      />
    );
    return compact ? (
      avatar
    ) : (
      <span className="flex size-36 shrink-0 items-center justify-center rounded-lg bg-background">
        {avatar}
      </span>
    );
  }
  return (
    <Art
      src={entry.image.url}
      category={kind === "profile_cover" ? "profileCovers" : "threadCovers"}
      className={compact ? "size-full" : "h-20 w-36 shrink-0 rounded-lg"}
    />
  );
}

// The frame as the live preview draws it: the picture through the LITE gate, and its proportions
// (the file's own, so that a frame that is not square is not stretched; square when unknown).
async function framePicture(image: { fileId: number; url: string }) {
  let aspect = 1;
  try {
    const { width, height } = await call(filesGet, { fileId: image.fileId });
    if (width && height) aspect = width / height;
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
  }
  return {
    aspect,
    picture: <Art src={image.url} category="frames" className="size-full" />,
  };
}

// The form of an entry, for a new one (no `entry`) or a change. A new picture is uploaded when it
// is chosen and named here; a frame also has its placement, which starts at the measured one. The
// placement and the display order are the advanced options.
async function EntryForm({ kind, entry }: { kind: ImageKind; entry?: Entry }) {
  const t = await getTranslations("adminAppearance.entryForm");
  const key = `${kind}-${entry?.id ?? "new"}`;
  const frame = entry?.image ? await framePicture(entry.image) : null;
  return (
    <EditForm action={saveImage} submit={entry ? undefined : t("create")}>
      <input type="hidden" name="kind" value={kind} />
      {entry && <input type="hidden" name="id" value={entry.id} />}
      <FieldGroup legend={t("group")}>
        <NameField idPrefix={key} defaultValue={entry?.name} />
        <Field
          name="fileId"
          label={entry ? t("replace") : t("picture")}
          htmlFor={`${key}-file`}
          help={entry ? t("replaceHelp") : t("pictureHelp")}
        >
          <PictureField
            purpose={IMAGE_KINDS[kind].purpose}
            name="fileId"
            id={`${key}-file`}
            current={
              entry?.image ? <Picture kind={kind} entry={entry} /> : undefined
            }
          />
        </Field>
        <ActiveField
          help={t("activeHelp")}
          defaultChecked={entry ? entry.isActive : true}
        />
      </FieldGroup>
      <Advanced fields={["placement", "placementNeeded", "position"]}>
        {kind === "frame" && (
          <Field
            name="placement"
            label={t("placement")}
            help={entry ? t("placementHelp") : t("placementHelpNew")}
          >
            <PlacementEditor
              idPrefix={`${key}-placement`}
              frame={frame?.picture ?? null}
              aspect={frame?.aspect ?? 1}
              initial={entry?.placement ?? null}
              canReset={Boolean(entry)}
            />
          </Field>
        )}
        <PositionField idPrefix={key} defaultValue={entry?.position} />
      </Advanced>
    </EditForm>
  );
}

// One picture catalog: its entries as rows with the active switch, the edit link and the delete.
// The backend does not say whether an entry is in use: deleting one that is deactivates it, and
// the notice says so.
export async function CatalogList({
  kind,
  searchParams,
}: {
  kind: ImageKind;
  searchParams: Promise<{
    notice?: string | string[];
    edit?: string | string[];
  }>;
}) {
  const [t, { items }, params] = await Promise.all([
    getTranslations("adminAppearance.catalog"),
    readCatalog(kind),
    searchParams,
  ]);
  const { key, path } = IMAGE_KINDS[kind];
  // The editor used to open on this page, as `?edit=<id>`; it has a page of its own now.
  const editing = parseId(
    (Array.isArray(params.edit) ? params.edit[0] : params.edit) ?? "",
  );
  if (editing !== null && items.some((entry) => entry.id === editing)) {
    redirect(`${path}/${editing}`);
  }
  return (
    <>
      <Notice
        namespace="adminAppearance.notices"
        searchParams={searchParams}
        shown={[
          "created",
          "saved",
          "reset",
          "ordered",
          "deleted",
          "deactivated",
        ]}
      />
      <ItemList
        label={t(`${key}.pageHeading`)}
        filter
        empty={{ title: t("none") }}
        items={items.map((entry) => ({
          id: entry.id,
          icon: <Picture kind={kind} entry={entry} compact />,
          title: entry.name,
          href: `${path}/${entry.id}`,
          description: (
            <>
              {t("order", { position: entry.position })}
              {entry.placement &&
                ` · ${t("measured", {
                  width: entry.placement.width,
                  left: entry.placement.left,
                  top: entry.placement.top,
                  scale: entry.placement.scale,
                })}`}
            </>
          ),
          badges: !entry.image && (
            <Badge variant="outline">{t("noPicture")}</Badge>
          ),
          toggle: (
            <RowToggle
              action={setImageActive}
              fields={{ kind, id: String(entry.id) }}
              checked={entry.isActive}
              label={t("activeLabel", { name: entry.name })}
            />
          ),
          actions: (
            <>
              <RowLink
                href={`${path}/${entry.id}`}
                label={t("editLabel", { name: entry.name })}
              />
              <ConfirmStep
                action={deleteImage}
                fields={{ kind, id: entry.id }}
                summary={`${t("delete")}…`}
                warning={t("deleteWarning")}
                submit={t("delete")}
              />
            </>
          ),
        }))}
      />
    </>
  );
}

// The page of a new entry (no `params`) or of the entry the address names.
export async function CatalogEdit({
  kind,
  params,
}: {
  kind: ImageKind;
  params?: Promise<{ id: string }>;
}) {
  if (!params) return <EntryForm kind={kind} />;
  const [{ id }, { items }] = await Promise.all([params, readCatalog(kind)]);
  const entry = items.find((item) => item.id === parseId(id));
  if (!entry) notFound();
  return <EntryForm kind={kind} entry={entry} />;
}

// The sort page: the entries with up and down arrows and one Save, through the order action.
export async function CatalogSort({ kind }: { kind: ImageKind }) {
  const [t, { items }] = await Promise.all([
    getTranslations("adminAppearance.catalog"),
    readCatalog(kind),
  ]);
  if (items.length === 0) {
    return (
      <EmptyState title={t("none")} className="rounded-lg border bg-card" />
    );
  }
  return (
    <SortForm
      action={saveImageOrder}
      name="position.{id}"
      heading={t(`${IMAGE_KINDS[kind].key}.pageHeading`)}
      description={t("sortHelp")}
      items={items.map((entry) => ({
        id: entry.id,
        title: entry.name,
        position: entry.position,
        icon: <Picture kind={kind} entry={entry} compact />,
        fields: {
          kind,
          [`before.${entry.id}`]: entry.position,
          [`title.${entry.id}`]: entry.name,
        },
      }))}
    />
  );
}
