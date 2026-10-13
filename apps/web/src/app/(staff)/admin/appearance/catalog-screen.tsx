import { catalogImagesList, filesGet } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Art } from "@/components/forum/art";
import { UserAvatar } from "@/components/forum/user-avatar";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { DeleteBox, EntryList } from "@/components/staff/entity-list";
import { InputRow, PositionActiveRows } from "@/components/staff/entity-rows";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Notice } from "@/components/staff/notice";
import { PictureField } from "@/components/staff/picture-field";
import { Badge } from "@/components/ui/badge";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import { deleteImage, saveImage } from "./actions";
import { IMAGE_KINDS, type ImageKind } from "./kinds";
import { PlacementEditor } from "./placement-editor";

type Entry = z.output<typeof catalogImagesList.output>["items"][number];

// The picture of an entry as members get it: a frame around a sample avatar, drawn by the public
// site's own avatar, or a cover in a box. Both go through the LITE gates.
async function Picture({ kind, entry }: { kind: ImageKind; entry: Entry }) {
  const t = await getTranslations("adminAppearance.catalog");
  if (!entry.image) {
    return (
      <span className="flex size-24 items-center justify-center rounded-lg border border-dashed p-2 text-center text-xs text-muted-foreground">
        {t("noPicture")}
      </span>
    );
  }
  if (kind === "frame") {
    return (
      <span className="flex size-36 shrink-0 items-center justify-center rounded-lg bg-background">
        <UserAvatar
          user={{
            username: t("sample"),
            avatar: null,
            frame: entry.placement
              ? { url: entry.image.url, placement: entry.placement }
              : null,
          }}
          size="2xl"
          link={false}
        />
      </span>
    );
  }
  return (
    <Art
      src={entry.image.url}
      category={kind === "profile_cover" ? "profileCovers" : "threadCovers"}
      className="h-20 w-36 shrink-0 rounded-lg"
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
// is chosen and named here; a frame also has its placement, which starts at the measured one.
async function EntryForm({ kind, entry }: { kind: ImageKind; entry?: Entry }) {
  const t = await getTranslations("adminAppearance.entryForm");
  const key = `${kind}-${entry?.id ?? "new"}`;
  const frame = entry?.image ? await framePicture(entry.image) : null;
  return (
    <FormRows
      action={saveImage}
      id={entry ? undefined : "new"}
      heading={entry ? t("headingEdit") : t("headingNew")}
      description={
        entry ? undefined : t(`descriptionNew.${IMAGE_KINDS[kind].key}`)
      }
      submit={entry ? undefined : t("create")}
    >
      <input type="hidden" name="kind" value={kind} />
      {entry && <input type="hidden" name="id" value={entry.id} />}
      <InputRow
        name="name"
        label={t("name")}
        idPrefix={key}
        required
        defaultValue={entry?.name}
      />
      <FieldRow
        name="fileId"
        label={entry ? t("replace") : t("picture")}
        htmlFor={`${key}-file`}
        help={entry ? t("replaceHelp") : t("pictureHelp")}
      >
        <PictureField
          purpose={IMAGE_KINDS[kind].purpose}
          name="fileId"
          id={`${key}-file`}
        />
      </FieldRow>
      {kind === "frame" && (
        <FieldRow
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
        </FieldRow>
      )}
      <PositionActiveRows
        idPrefix={key}
        position={t("position")}
        active={t("active")}
        activeHelp={t("activeHelp")}
        entry={entry}
      />
    </FormRows>
  );
}

// One picture catalog: its entries in display order (inactive ones and ones waiting for a picture
// too), each with its editor and its delete behind a disclosure, then the form for a new one. A
// catalog holds at most 500 entries and the backend does not page it. The backend does not say
// whether an entry is in use: deleting one that is deactivates it, and the notice says so.
export async function CatalogScreen({
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
    read(catalogImagesList, { kind }),
    searchParams,
  ]);
  const editing = parseId(
    (Array.isArray(params.edit) ? params.edit[0] : params.edit) ?? "",
  );
  const { key, path } = IMAGE_KINDS[kind];
  return (
    <>
      <Notice
        namespace="adminAppearance.notices"
        searchParams={searchParams}
        shown={["created", "saved", "reset", "deleted", "deactivated"]}
      />
      <EntryList
        heading={t(`${key}.heading`)}
        description={t(`${key}.description`)}
        none={t("none")}
        items={items.map((entry) => (
          <li key={entry.id} id={`entry-${entry.id}`} className="scroll-mt-4">
            <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Picture kind={kind} entry={entry} />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block text-sm font-medium [overflow-wrap:anywhere]">
                  {entry.name}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {t("order", { position: entry.position })}
                  {entry.isActive ? (
                    <Badge variant="success">{t("active")}</Badge>
                  ) : (
                    <Badge variant="outline">{t("inactive")}</Badge>
                  )}
                  {entry.placement && (
                    <span>
                      {t("measured", {
                        width: entry.placement.width,
                        left: entry.placement.left,
                        top: entry.placement.top,
                        scale: entry.placement.scale,
                      })}
                    </span>
                  )}
                </span>
              </span>
              <Link
                href={
                  editing === entry.id
                    ? path
                    : `${path}?edit=${entry.id}#entry-${entry.id}`
                }
                scroll={false}
                className="inline-flex min-h-10 min-w-10 items-center justify-center text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {editing === entry.id ? t("close") : t("edit")}
              </Link>
            </div>
            {editing === entry.id && (
              <div className="space-y-4 border-t p-4">
                <EntryForm kind={kind} entry={entry} />
                <DeleteBox>
                  <ConfirmStep
                    action={deleteImage}
                    fields={{ kind, id: entry.id }}
                    summary={`${t("delete")}…`}
                    warning={t("deleteWarning")}
                    submit={t("delete")}
                  />
                </DeleteBox>
              </div>
            )}
          </li>
        ))}
      />
      <EntryForm kind={kind} />
    </>
  );
}
